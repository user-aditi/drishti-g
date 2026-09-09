"""Learn how long work actually takes, and export it for TypeScript to run.

    python -m drishti_research.sla

What this replaces
------------------
Today every complaint gets ``category.defaultSlaHours`` — one number per
category, the same in a sector with four open jobs and one with six hundred.
The citizen is then told a hard deadline derived from it, which is a promise the
system has no evidence it can keep.

What it becomes
---------------
Observed resolution times, bucketed by **category x org unit x priority**, and
reported as a *range* rather than a point. Two quantiles are exported:

``p50``  what usually happens — the sentence a citizen actually wants.
``p90``  the commitment. GCCE sets the deadline from this, so the promise is one
         the unit has historically kept nine times in ten rather than a target
         somebody typed into a seed file.

Why empirical quantiles and not a regression
--------------------------------------------
Resolution time here is a long-tailed positive quantity with a floor, and the
predictors are three categoricals. A quantile regression over one-hot encodings
of three categoricals *is* a lookup table, reached by a slower route and with
coefficients nobody can read. The buildbook allows either; this takes the one
whose output an officer can be shown.

The bucketing problem, which is the real work
---------------------------------------------
Category x unit x priority is a large product and observations are not spread
evenly across it: a few busy sectors carry most of the traffic and most cells
are empty or nearly so. A p90 computed from three cases is noise wearing a
number, and shipping it would produce deadlines that swing wildly between
neighbouring sectors for no reason a citizen could be told.

So each cell backs off until it has enough support:

    category x unit x priority   ->   category x unit   ->   category
                                 ->   the seeded default

``MIN_SUPPORT`` is the number of resolutions a cell needs before it is trusted.
The export records, for every bucket, which level actually answered — so the
service can say *"usually 2 to 4 days in this sector"* only where that is a
statement about the sector, and fall back to plainer language where it is not.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research" / "data" / "resolutions.csv"
SPEC_OUT = ROOT / "backend" / "data" / "sla-spec.json"

MODEL_VERSION = "sla-v1-quantiles"

#: Bump alongside sla.ts whenever the bucket key or the backoff order changes.
CONTRACT = "sla/empirical-quantiles/1"

#: Resolutions a bucket needs before its quantiles are trusted. Below this the
#: estimate backs off to a wider bucket. Ten is not a deep result — it is the
#: point where a p90 stops being one unlucky case.
MIN_SUPPORT = 10

#: Anything past this is treated as a case that stalled rather than one that
#: took a long time, and is excluded from the quantiles. Kept generous: the
#: point is to drop the abandoned, not to flatter the numbers.
MAX_PLAUSIBLE_DAYS = 120


def load() -> pd.DataFrame:
    if not DATA.exists():
        raise SystemExit(
            f"No resolution history at {DATA}.\nRun:  cd backend && npm run export:resolutions"
        )

    frame = pd.read_csv(DATA)
    frame = frame.dropna(subset=["hours", "category_id"])
    frame = frame[(frame["hours"] > 0) & (frame["hours"] <= MAX_PLAUSIBLE_DAYS * 24)]
    return frame


def quantiles(hours: np.ndarray) -> dict[str, float]:
    return {
        "p50": round(float(np.percentile(hours, 50)), 1),
        "p90": round(float(np.percentile(hours, 90)), 1),
    }


def main() -> None:
    frame = load()
    print(f"--- SLA estimator --- {len(frame)} resolutions")
    print(f"    {frame['category_id'].nunique()} categories, {frame['org_unit_id'].nunique()} units")
    print()

    buckets: dict[str, dict] = {}

    # Level 3 — the specific claim: this category, this unit, this priority.
    for (category, unit, priority), rows in frame.groupby(
        ["category_id", "org_unit_id", "priority"], dropna=True
    ):
        if len(rows) < MIN_SUPPORT:
            continue
        key = f"{int(category)}|{int(unit)}|{priority}"
        buckets[key] = {**quantiles(rows["hours"].to_numpy()), "n": len(rows), "level": "unit+priority"}

    # Level 2 — this category in this unit, whatever the priority.
    for (category, unit), rows in frame.groupby(["category_id", "org_unit_id"], dropna=True):
        if len(rows) < MIN_SUPPORT:
            continue
        key = f"{int(category)}|{int(unit)}|*"
        buckets[key] = {**quantiles(rows["hours"].to_numpy()), "n": len(rows), "level": "unit"}

    # Level 1 — this category anywhere. Almost always has support.
    for category, rows in frame.groupby("category_id", dropna=True):
        if len(rows) < MIN_SUPPORT:
            continue
        key = f"{int(category)}|*|*"
        buckets[key] = {**quantiles(rows["hours"].to_numpy()), "n": len(rows), "level": "category"}

    by_level: dict[str, int] = {}
    for bucket in buckets.values():
        by_level[bucket["level"]] = by_level.get(bucket["level"], 0) + 1

    print("  buckets with enough support:")
    for level in ("unit+priority", "unit", "category"):
        print(f"    {level:<16} {by_level.get(level, 0)}")
    print()

    # --- how the learned deadline compares with the seeded one -------------
    #
    # The number that decides whether this is worth shipping. If the fixed table
    # was already generous, a learned p90 changes nothing except the wording.
    if "default_sla_hours" in frame.columns:
        compare = []
        for category, rows in frame.groupby("category_id", dropna=True):
            if len(rows) < MIN_SUPPORT:
                continue
            observed = quantiles(rows["hours"].to_numpy())
            seeded = float(rows["default_sla_hours"].iloc[0])
            breached = float((rows["hours"] > seeded).mean())
            compare.append(
                {
                    "category": rows["category_name"].iloc[0],
                    "seeded": seeded,
                    "p50": observed["p50"],
                    "p90": observed["p90"],
                    "breach_under_seeded": breached,
                }
            )

        print("  category                          seeded    p50    p90   breach @ seeded")
        for row in sorted(compare, key=lambda r: -r["breach_under_seeded"]):
            print(
                f"  {row['category'][:32]:<32} {row['seeded']:>6.0f} {row['p50']:>6.1f} "
                f"{row['p90']:>6.1f}   {row['breach_under_seeded']:>6.1%}"
            )
        print()

        overall = float((frame["hours"] > frame["default_sla_hours"]).mean())
        print(f"  breach rate under the seeded deadlines : {overall:.1%}")

        # What the breach rate would be if the deadline were the learned p90.
        p90_by_category = {
            int(c): quantiles(r["hours"].to_numpy())["p90"]
            for c, r in frame.groupby("category_id", dropna=True)
            if len(r) >= MIN_SUPPORT
        }
        learned = frame["category_id"].map(p90_by_category)
        covered = learned.notna()
        if covered.any():
            rate = float((frame.loc[covered, "hours"] > learned[covered]).mean())
            print(f"  breach rate under a learned p90        : {rate:.1%}")
            print("  (a p90 deadline should breach about 10% of the time by construction —")
            print("   that is what makes it a promise rather than an aspiration)")
        print()

    export(buckets, len(frame))


def export(buckets: dict[str, dict], trained_on: int) -> None:
    spec = {
        "contract": CONTRACT,
        "modelVersion": MODEL_VERSION,
        "trainedAt": pd.Timestamp.utcnow().isoformat(),
        "trainedOn": trained_on,
        "minSupport": MIN_SUPPORT,
        "buckets": buckets,
    }
    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec), encoding="utf-8")
    print(f"  wrote {SPEC_OUT.relative_to(ROOT)} ({SPEC_OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(buckets)} buckets")


if __name__ == "__main__":
    main()
