"""Phase 7 — is there a routing problem in NYC 311 for GCCE to solve?

    python -m drishti_research.nyc_routing [--refresh]

F-23 found GCCE's planned measurement had nothing to measure: each of the six
complaint types this replica carries is worked by exactly one agency, so always
picking the usual agency scores 100%. The fix proposed on 11 September 2026 was
to widen the slice with Noise. **That proposal was wrong, and was measured
before anything was built on it.** Each of NYC's eight noise complaint types goes
to exactly one agency — "Noise - Residential" to NYPD, "Noise" to DEP, and so on.

NYC's taxonomy is agency-scoped. Of 188 complaint types filed in Brooklyn in
2024, 184 were worked by a single agency; the four that were not covered 1.9% of
requests: Encampment (NYPD or DHS), Highway Condition (DOT or DSNY), Asbestos
(DEP or DOHMH) and Graffiti (DSNY or NYPD). For everything else, choosing the
complaint type *is* choosing the agency, and there is no routing decision left
for a model to make.

So this arm is those four types, and its question is deliberately narrow: for a
request of one of them, does what is known at intake predict which agency will
work it better than always choosing that type's usual agency?

Intake fields only
------------------
Descriptor, location type, channel and community board: things the filer
supplies, or the channel records, before any agency has touched the request.
Never the status, the resolution text or the closure date — those are written by
the agency the request was routed to, and routing on them would be reading the
answer.

Split by time, not at random
----------------------------
A router is used on requests that have not happened yet. A random split lets it
learn from requests filed after the one it is routing, and agencies'
responsibilities drift: DHS worked 23% of Brooklyn's Encampment requests in 2024
and 26% in 2025. So candidates are **chosen** on 2024 having been fitted on
2022–2023, and the chosen one is **reported once** on 2025 having been fitted on
2022–2024. The shipped tables are then refitted on all four years.

Models are lookup tables, and that is a choice
----------------------------------------------
Each candidate is a chain of tables: the most frequent agency for this type and
these intake values, backing off to fewer values when a cell has fewer than
``MIN_SUPPORT`` earlier requests, and finally to the type's usual agency. A table
can be executed exactly by the backend — no Python in the request path — and
every decision it makes explains itself in one sentence: "of 312 earlier
Encampment requests with this descriptor at this kind of location, 81% were
worked by DHS".

The gate, as the plan states it: beat the modal-agency baseline. Here that means
the paired bootstrap interval on the 2025 accuracy gain lies above zero.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .nyc import BOROUGH, DATA, DATASET, PERIOD_END, PERIOD_START, board_number, fetch_csv, slice_where

ROUTING_TYPES = ("Encampment", "Highway Condition", "Asbestos", "Graffiti")

CORPUS = DATA / "routing.csv"
PARTS = DATA / "routing-parts"
MANIFEST = DATA / "routing.meta.json"
ROOT = DATA.parents[2]
SPEC_OUT = ROOT / "backend" / "data" / "gcce-spec.json"
RESULTS_OUT = ROOT / "research" / "results" / "nyc-routing.csv"

#: Bump with ``GCCE_CONTRACT`` in backend/src/services/gcce.ts when the table
#: format or the backoff rule changes.
CONTRACT = "gcce-table/1"

#: A table cell needs this many earlier requests before it is trusted over a
#: coarser one. Twenty is the panel's own floor for a unit-month.
MIN_SUPPORT = 20

#: A richer candidate must beat the next simpler by this much on validation.
PARSIMONY = 0.005

N_BOOTSTRAP = 2000
SEED = 20260911

#: Each candidate is its backoff chain, richest key first. Listed simplest first,
#: which is also the parsimony order.
CANDIDATES: dict[str, list[tuple[str, ...]]] = {
    "modal": [()],
    "descriptor": [("descriptor",), ()],
    "descriptor_location": [("descriptor", "location_type"), ("descriptor",), ()],
    "descriptor_channel": [("descriptor", "channel"), ("descriptor",), ()],
    "full": [
        ("descriptor", "location_type", "channel", "board"),
        ("descriptor", "location_type"),
        ("descriptor",),
        (),
    ],
}


# --- data -----------------------------------------------------------------------


def load(refresh: bool = False) -> pd.DataFrame:
    """The four shared types, Brooklyn, 2022-2025. Pulled once, then frozen."""
    if CORPUS.exists() and not refresh:
        frame = pd.read_csv(CORPUS, dtype=str, keep_default_na=False, na_values=[""])
    else:
        if refresh and PARTS.exists():
            for part in PARTS.glob("part-*.csv"):
                part.unlink()
        where = slice_where(complaint_types=ROUTING_TYPES)
        print(f"pulling the routing slice\n{where}\n")
        frame = fetch_csv(where, cache=PARTS)
        frame.to_csv(CORPUS, index=False)
        MANIFEST.write_text(
            json.dumps(
                {
                    "dataset": DATASET,
                    "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "borough": BOROUGH,
                    "period": [PERIOD_START, PERIOD_END],
                    "complaint_types": list(ROUTING_TYPES),
                    "where": where,
                    "rows": len(frame),
                    "attribution": "NYC Open Data, 311 Service Requests (erm2-nwe9)",
                },
                indent=2,
            )
            + "\n"
        )

    frame["created_date"] = pd.to_datetime(frame["created_date"], errors="coerce")
    frame["year"] = frame["created_date"].dt.year
    frame["board"] = frame["community_board"].map(board_number).astype("string").fillna("")
    frame["channel"] = frame["open_data_channel_type"].fillna("").str.upper()
    for column in ("descriptor", "location_type"):
        frame[column] = frame[column].fillna("").str.strip()
    return frame[frame["agency"].notna() & frame["year"].notna()].reset_index(drop=True)


# --- tables ---------------------------------------------------------------------


def fit(train: pd.DataFrame, chain: list[tuple[str, ...]]) -> dict:
    """One table per link of the chain: key -> (agency, support, share)."""
    tables = {}
    for level, key in enumerate(chain):
        columns = ["complaint_type", *key]
        counts = train.groupby([*columns, "agency"], observed=True).size().rename("n").reset_index()
        support = counts.groupby(columns, observed=True)["n"].transform("sum")
        counts = counts.assign(support=support, share=counts["n"] / support)
        # Ties broken alphabetically so a refit on the same data is the same table.
        counts = counts.sort_values([*columns, "n", "agency"], ascending=[True] * len(columns) + [False, True])
        best = counts.drop_duplicates(columns, keep="first")
        best = best[best["support"] >= (MIN_SUPPORT if key else 1)]
        tables[level] = {
            tuple(row[c] for c in columns): (row["agency"], int(row["support"]), float(row["share"]))
            for _, row in best.iterrows()
        }
    return tables


def predict(frame: pd.DataFrame, chain: list[tuple[str, ...]], tables: dict) -> tuple[np.ndarray, np.ndarray]:
    """Predicted agency and the chain level that decided it (-1: type never seen)."""
    agencies = np.empty(len(frame), dtype=object)
    levels = np.full(len(frame), -1)
    records = frame.to_dict("records")
    for i, row in enumerate(records):
        for level, key in enumerate(chain):
            hit = tables[level].get((row["complaint_type"], *(row[c] for c in key)))
            if hit is not None:
                agencies[i], levels[i] = hit[0], level
                break
    return agencies, levels


def accuracy(frame: pd.DataFrame, predicted: np.ndarray) -> float:
    return float((frame["agency"].to_numpy() == predicted).mean())


def bootstrap_gain(truth: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Paired bootstrap on accuracy(a) - accuracy(b)."""
    ca, cb = (a == truth).astype(float), (b == truth).astype(float)
    rng = np.random.default_rng(SEED)
    draws = [
        (ca[idx] - cb[idx]).mean() for idx in (rng.integers(0, len(truth), len(truth)) for _ in range(N_BOOTSTRAP))
    ]
    low, high = np.percentile(draws, [2.5, 97.5])
    return float(ca.mean() - cb.mean()), float(low), float(high)


# --- run ------------------------------------------------------------------------


def run(refresh: bool = False) -> dict:
    frame = load(refresh)
    print(f"Phase 7 - the routing arm: {len(frame):,} requests of {len(ROUTING_TYPES)} shared types\n")

    print("who worked them, by year")
    shares = frame.groupby(["complaint_type", "year", "agency"]).size().unstack("agency", fill_value=0)
    print((shares.div(shares.sum(axis=1), axis=0)).round(3).to_string(), "\n")

    fit_v, val = frame[frame["year"] <= 2023], frame[frame["year"] == 2024]
    fit_t, test = frame[frame["year"] <= 2024], frame[frame["year"] == 2025]

    rows = []
    predictions = {}
    for name, chain in CANDIDATES.items():
        v_pred, _ = predict(val, chain, fit(fit_v, chain))
        t_pred, t_level = predict(test, chain, fit(fit_t, chain))
        predictions[name] = (t_pred, t_level)
        row = {"candidate": name, "validation_2024": accuracy(val, v_pred), "test_2025": accuracy(test, t_pred)}
        for kind in ROUTING_TYPES:
            mask = (test["complaint_type"] == kind).to_numpy()
            row[f"test_{kind}"] = accuracy(test[mask], t_pred[mask])
        rows.append(row)
    results = pd.DataFrame(rows).set_index("candidate")

    # Chosen on 2024 alone; 2025 is read only after the choice.
    best = results["validation_2024"].max()
    chosen = next(n for n in CANDIDATES if results.loc[n, "validation_2024"] >= best - PARSIMONY)

    print(f"{'candidate':<28}{'2024 (choose)':>14}{'2025 (report)':>15}")
    for name, row in results.iterrows():
        mark = "  <- chosen" if name == chosen else ""
        print(f"{name:<28}{row['validation_2024']:>14.2%}{row['test_2025']:>15.2%}{mark}")

    truth = test["agency"].to_numpy()
    gain, low, high = bootstrap_gain(truth, predictions[chosen][0], predictions["modal"][0])
    passed = low > 0
    print(
        f"\n2025, {chosen} vs modal agency: {gain:+.2%} [{low:+.2%}, {high:+.2%}] "
        f"-> gate {'PASS' if passed else 'FAIL'} (beat the modal baseline)"
    )
    print("\nper type, 2025")
    for kind in ROUTING_TYPES:
        print(
            f"  {kind:<20} n={int((test['complaint_type'] == kind).sum()):>6}  modal "
            f"{results.loc['modal', f'test_{kind}']:.2%}  {chosen} {results.loc[chosen, f'test_{kind}']:.2%}"
        )

    # Shipped: refitted on all four years, now that the choice and the report are made.
    chain = CANDIDATES[chosen]
    tables = fit(frame, chain)
    cells = []
    for level, key in enumerate(chain):
        for values, (agency, support, share) in tables[level].items():
            cells.append(
                {
                    "level": level,
                    "type": values[0],
                    "values": list(values[1:]),
                    "agency": agency,
                    "support": support,
                    "share": round(share, 4),
                }
            )
    spec = {
        "contract": CONTRACT,
        "modelVersion": f"nyc-routing-{chosen.replace('_', '-')}-{datetime.now(timezone.utc):%Y%m%d}",
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "research/drishti_research/nyc_routing.py",
        "chosen": chosen,
        "types": list(ROUTING_TYPES),
        "chain": [list(key) for key in chain],
        "minSupport": MIN_SUPPORT,
        "cells": cells,
        "evaluation": {
            "trainedOn": "2022-2024 for the report; all of 2022-2025 for the shipped tables",
            "testYear": 2025,
            "testRows": int(len(test)),
            "accuracy": {n: round(results.loc[n, "test_2025"], 4) for n in CANDIDATES},
            "validation": {n: round(results.loc[n, "validation_2024"], 4) for n in CANDIDATES},
            "perType": {
                kind: {
                    "rows": int((test["complaint_type"] == kind).sum()),
                    "modal": round(results.loc["modal", f"test_{kind}"], 4),
                    "chosen": round(results.loc[chosen, f"test_{kind}"], 4),
                }
                for kind in ROUTING_TYPES
            },
            "gainOverModal": {"gain": round(gain, 4), "ciLow": round(low, 4), "ciHigh": round(high, 4)},
            "gatePassed": passed,
        },
    }
    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    RESULTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    results.to_csv(RESULTS_OUT)
    print(f"\n{len(cells)} table cells; written {SPEC_OUT.relative_to(ROOT)} and {RESULTS_OUT.relative_to(ROOT)}")
    return spec


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="pull the slice again")
    run(**vars(parser.parse_args()))
