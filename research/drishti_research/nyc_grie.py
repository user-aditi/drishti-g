"""Phase 7 — GRIE fitted to NYC, calibrated, and exported to the backend.

    python -m drishti_research.nyc_grie

V5 found that GRIE's hand-specified weights cost 0.123 AUC on the NYC panel,
and that the same five factors with tuned weights reach parity with both black
boxes (F-18). The decision of 11 September 2026: ship tuned weights, and report
the hand-specified model as the finding rather than quietly replacing it. This
module is where that happens, and it writes the only GRIE model the backend
will execute.

The candidates
--------------
All four are scored under V5's protocol — five repeats of grouped, stratified
five-fold, no board's months on both sides of a split — so their numbers are
comparable to V5's and to each other.

``hand``          GRIE as it was: NOIDA's weights and NOIDA's saturation caps.
                  This is F-18's number, reproduced, not a candidate to ship.
``persistence``   this month's missed-deadline rate and nothing else. Not a
                  candidate: the reference every multi-factor score has to beat.
                  The label is next month's missed-deadline rate and that rate is
                  autocorrelated at +0.77 (V4), so a model that has learned only
                  "what happened last month continues" would score well without
                  the other four factors contributing anything.
``tuned_noida``   V5's tuned arm: fitted weights, NOIDA's caps.
``tuned_nyc``     fitted weights, and the two linear curves' caps re-derived
                  from NYC — the 95th percentile of the training folds.
``tuned_agency``  as ``tuned_nyc``, but each agency gets its own caps. This is
                  the direct answer to F-20: DOT carries eight times DEP's open
                  load, so one pooled cap reads agency identity as risk.

Caps are derived inside each fold from its training rows only, for the same
reason the weights are: a cap computed on the whole panel has seen the test set.

How the one that ships is chosen — declared here before the run
---------------------------------------------------------------
1. **Eligibility.** A candidate is out if any factor sits at its cap for more
   than half the panel. A factor that reads 100/100 for most units still moves
   the ranking a little, but its line in an explanation says nothing, and the
   product's promise is the explanation. NOIDA's load cap of 25 is at or below
   the open load of 76% of NYC unit-months.
2. **Metric.** Mean within-agency AUC on out-of-fold scores. The register is read
   within an agency — a DOT supervisor comparing DOT boards — and pooled AUC
   rewards a model for sorting agencies, which is F-20's confound.
3. **Parsimony.** Among eligible candidates within 0.005 of the best, the one
   with fewer parameters wins: ``tuned_noida`` < ``tuned_nyc`` < ``tuned_agency``.

Calibration ships with the model (N7)
-------------------------------------
A weighted sum on 0-100 reads like a probability and is not one. The exported
model carries an isotonic map from score to the observed rate of the label, fitted
on out-of-fold scores so no unit-month is calibrated by a map that saw it. The
backend shows that probability — "chance of being in the worst fifth next month"
— and never the bare score as if it were one.

What the backend has to reproduce
---------------------------------
The backend computes the five signals from its own database, which holds the
same 355,430 requests. ``research/results/nyc-grie-panel.csv`` carries every
unit-month's features, score and probability as computed here, and
``npm run layer3:measure`` checks the backend arrives at the same numbers. The
marker phrases and thresholds travel inside the spec so there is one copy of
each, not two that can drift.
"""

from __future__ import annotations

import hashlib
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

from .calibration_check import brier, calibrate, expected_calibration_error
from .model_spec import load_spec
from .nyc_signals import (
    DUPLICATE_MARKERS,
    ENFORCEMENT_MARKERS,
    FEATURE_KEYS,
    LABEL_QUANTILE,
    MIN_REQUESTS_PER_PERIOD,
    REFERRAL_MARKERS,
    build_panel,
)
from .nyc_study import ENTITY_TYPE, N_REPEATS, N_SPLITS, SEED, _bootstrap_gap
from .tuning import MIN_WEIGHT, _softmax

ROOT = Path(__file__).resolve().parents[2]
SPEC_OUT = ROOT / "backend" / "data" / "grie-spec.json"
PANEL_OUT = ROOT / "research" / "results" / "nyc-grie-panel.csv"
RESULTS_OUT = ROOT / "research" / "results" / "nyc-grie-candidates.csv"

#: Bump with ``GRIE_CONTRACT`` in backend/src/services/grie.ts whenever the maths
#: of scoring, the curves or the calibration map changes shape.
CONTRACT = "grie-nyc/1"

LINEAR = ("openComplaintLoad", "avgResolutionDays")
CAP_QUANTILE = 0.95
SATURATION_LIMIT = 0.5
PARSIMONY = 0.005
CANDIDATES = ("hand", "persistence", "tuned_noida", "tuned_nyc", "tuned_agency")
SHIPPABLE = ("tuned_noida", "tuned_nyc", "tuned_agency")

#: Probability at or above which a unit is flagged for review. A declared product
#: choice, not a measured one: "more likely than not to be in the worst fifth
#: next month". The base rate is 20%, so this is 2.5 times it.
REVIEW_PROBABILITY = 0.5

#: Labels as an officer reads them. "Escalations" was NOIDA's word; here the
#: signal is NYC's own referrals and enforcement actions, and Layer 2 has since
#: given "escalation" a different meaning in this product.
LABELS = {
    "slaBreachRate": "Missed deadlines",
    "repeatComplaintRate": "Repairs that did not hold",
    "escalationRate": "Referred or enforced",
    "openComplaintLoad": "Open requests",
    "avgResolutionDays": "Days to close",
}


# --- scoring ------------------------------------------------------------------


def _caps(X: pd.DataFrame, agency: np.ndarray, mode: str, noida: dict[str, float]) -> dict:
    """{feature: {"*": pooled cap, agency: cap, ...}} for the linear curves."""
    if mode == "noida":
        return {k: {"*": noida[k]} for k in LINEAR}
    caps: dict[str, dict[str, float]] = {}
    for key in LINEAR:
        pooled = float(np.quantile(X[key], CAP_QUANTILE))
        caps[key] = {"*": max(pooled, 1e-9)}
        if mode == "agency":
            for name in np.unique(agency):
                values = X.loc[agency == name, key]
                caps[key][str(name)] = max(float(np.quantile(values, CAP_QUANTILE)), 1e-9)
    return caps


def _normalise(X: pd.DataFrame, agency: np.ndarray, caps: dict) -> np.ndarray:
    """Every signal on 0-100: proportions scaled, linear signals capped."""
    columns = []
    for key in FEATURE_KEYS:
        raw = X[key].to_numpy(dtype=float)
        if key in LINEAR:
            cap = np.array([caps[key].get(str(a), caps[key]["*"]) for a in agency])
            columns.append(np.clip(np.where(raw <= 0, 0.0, raw / cap * 100.0), 0.0, 100.0))
        else:
            columns.append(np.clip(raw * 100.0, 0.0, 100.0))
    return np.column_stack(columns)


def _tune(normalised: np.ndarray, y: np.ndarray, start: np.ndarray) -> np.ndarray:
    """tuning.tune_weights' search, over an already-normalised matrix.

    Same objective (negative AUC), same simplex-with-floor parametrisation, same
    starting point (the hand-specified weights) and the same refusal to return a
    worse model than it started from. Re-stated here only because tune_weights
    normalises through the NOIDA spec's curves, and three of the candidates use
    different ones.
    """
    before = roc_auc_score(y, normalised @ start)

    def objective(z: np.ndarray) -> float:
        scores = normalised @ _softmax(z, MIN_WEIGHT)
        return 0.0 if np.allclose(scores, scores[0]) else -roc_auc_score(y, scores)

    result = minimize(
        objective,
        np.log(np.clip(start, 1e-6, None)),
        method="Nelder-Mead",
        options={"maxiter": 400, "xatol": 1e-4, "fatol": 1e-6},
    )
    tuned = _softmax(result.x, MIN_WEIGHT)
    return tuned if roc_auc_score(y, normalised @ tuned) >= before else start


def _fit(candidate: str, X: pd.DataFrame, agency: np.ndarray, y: np.ndarray, hand: np.ndarray, noida):
    mode = {
        "hand": "noida",
        "persistence": "noida",
        "tuned_noida": "noida",
        "tuned_nyc": "pooled",
        "tuned_agency": "agency",
    }[candidate]
    caps = _caps(X, agency, mode, noida)
    if candidate == "hand":
        return hand, caps
    if candidate == "persistence":
        return np.array([1.0 if k == "slaBreachRate" else 0.0 for k in FEATURE_KEYS]), caps
    weights = _tune(_normalise(X, agency, caps), y, hand)
    return weights, caps


# --- evaluation -----------------------------------------------------------------


def _within_agency_auc(y: np.ndarray, scores: np.ndarray, agency: np.ndarray) -> dict[str, float]:
    out = {}
    for name in np.unique(agency):
        mask = agency == name
        if len(np.unique(y[mask])) == 2:
            out[str(name)] = float(roc_auc_score(y[mask], scores[mask]))
    return out


def evaluate(panel: pd.DataFrame, hand: np.ndarray, noida: dict[str, float]):
    X = panel[FEATURE_KEYS].astype(float).reset_index(drop=True)
    y = panel["failed"].to_numpy()
    agency = panel["agency"].astype(str).to_numpy()
    groups = (panel["agency"].astype(str) + "/" + panel["board"].astype(str)).to_numpy()

    fold_aucs: dict[str, list[float]] = {c: [] for c in CANDIDATES}
    oof_runs: dict[str, list[np.ndarray]] = {c: [] for c in CANDIDATES}

    for repeat in range(N_REPEATS):
        splitter = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=SEED + repeat)
        oof = {c: np.full(len(y), np.nan) for c in CANDIDATES}
        for train, test in splitter.split(X, y, groups):
            if len(np.unique(y[test])) < 2:
                continue
            for candidate in CANDIDATES:
                weights, caps = _fit(candidate, X.iloc[train], agency[train], y[train], hand, noida)
                scores = _normalise(X.iloc[test], agency[test], caps) @ weights
                oof[candidate][test] = scores
                fold_aucs[candidate].append(roc_auc_score(y[test], scores))
        for candidate in CANDIDATES:
            oof_runs[candidate].append(oof[candidate])
        print(f"  repeat {repeat + 1}/{N_REPEATS} done", flush=True)

    oof_mean = {c: np.nanmean(np.vstack(v), axis=0) for c, v in oof_runs.items()}

    rows = []
    for candidate in CANDIDATES:
        # Saturation is judged on the whole-panel fit, which is the model that
        # would ship: the share of unit-months each factor spends at its cap.
        weights, caps = _fit(candidate, X, agency, y, hand, noida)
        normalised = _normalise(X, agency, caps)
        saturation = {k: float((normalised[:, i] >= 100.0).mean()) for i, k in enumerate(FEATURE_KEYS)}
        within = _within_agency_auc(y, oof_mean[candidate], agency)
        rows.append(
            {
                "candidate": candidate,
                "test_auc": float(np.mean(fold_aucs[candidate])),
                "test_sd": float(np.std(fold_aucs[candidate], ddof=1)),
                "oof_auc": float(roc_auc_score(y, oof_mean[candidate])),
                "within_agency_auc": float(np.mean(list(within.values()))),
                **{f"auc_{a}": v for a, v in within.items()},
                "max_saturation": max(saturation.values()),
                "saturated_factor": max(saturation, key=saturation.get),
                **{f"weight_{k}": float(w) for k, w in zip(FEATURE_KEYS, weights)},
            }
        )
    return pd.DataFrame(rows).set_index("candidate"), oof_mean, X, y, agency, groups


def choose(results: pd.DataFrame) -> str:
    """The rule in the module docstring, applied mechanically."""
    eligible = results.loc[list(SHIPPABLE)]
    eligible = eligible[eligible["max_saturation"] <= SATURATION_LIMIT]
    if eligible.empty:
        raise SystemExit("no candidate is eligible to ship; every one has a saturated factor")
    best = eligible["within_agency_auc"].max()
    for candidate in SHIPPABLE:  # simplest first
        if candidate in eligible.index and eligible.loc[candidate, "within_agency_auc"] >= best - PARSIMONY:
            return candidate
    raise AssertionError("unreachable")


# --- export ---------------------------------------------------------------------


def export(panel, chosen, results, oof_mean, X, y, agency, groups, hand, noida) -> dict:
    weights, caps = _fit(chosen, X, agency, y, hand, noida)
    final_scores = _normalise(X, agency, caps) @ weights

    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0, increasing=True)
    iso.fit(oof_mean[chosen], y)

    raw_p = oof_mean[chosen] / 100.0
    calibrated = calibrate(y, oof_mean[chosen], groups)
    rng = np.random.default_rng(SEED)
    gap, low, high = _bootstrap_gap(y, oof_mean[chosen], oof_mean["hand"], rng)
    p_gap, p_low, p_high = _bootstrap_gap(y, oof_mean[chosen], oof_mean["persistence"], rng)

    factors = []
    for key, weight in zip(FEATURE_KEYS, weights):
        curve: dict = {"kind": "proportion"}
        if key in LINEAR:
            curve = {"kind": "linear", "cap": caps[key]["*"]}
            by_agency = {a: c for a, c in caps[key].items() if a != "*"}
            if by_agency:
                curve["capByAgency"] = by_agency
        factors.append({"key": key, "label": LABELS[key], "weight": float(weight), "curve": curve})

    evaluation = {
        candidate: {
            "cvAuc": round(row["test_auc"], 4),
            "cvAucSd": round(row["test_sd"], 4),
            "withinAgencyAuc": round(row["within_agency_auc"], 4),
            "maxSaturation": round(row["max_saturation"], 3),
            "saturatedFactor": row["saturated_factor"],
        }
        for candidate, row in results.iterrows()
    }
    calibration = {
        "kind": "isotonic",
        "x": [float(v) for v in iso.X_thresholds_],
        "y": [float(v) for v in iso.y_thresholds_],
    }
    # The version names the content, not just the day: two models exported on the
    # same date with different weights must not share a version, or their stored
    # scores could not be told apart.
    digest = hashlib.sha256(
        json.dumps({"factors": factors, "calibration": calibration}, sort_keys=True).encode()
    ).hexdigest()[:8]
    spec = {
        "contract": CONTRACT,
        "modelVersion": f"nyc-{chosen.replace('_', '-')}-{datetime.now(timezone.utc):%Y%m%d}-{digest}",
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "research/drishti_research/nyc_grie.py",
        "chosen": chosen,
        "unit": "agency x community board x calendar month",
        "minRequests": MIN_REQUESTS_PER_PERIOD,
        "label": {
            "description": (
                "Next month, this unit's share of requests past their derived deadline lands in "
                f"the worst {1 - LABEL_QUANTILE:.0%} of the panel"
            ),
            "quantile": LABEL_QUANTILE,
            "cutoff": float(panel.attrs["label_cutoff"]),
            "baseRate": float(y.mean()),
        },
        "trainedOn": {
            "rows": int(len(panel)),
            "units": int(len(np.unique(groups))),
            "firstMonth": str(panel["month"].min()),
            "lastMonth": str(panel["month"].max()),
        },
        "markers": {
            "referral": list(REFERRAL_MARKERS),
            "enforcement": list(ENFORCEMENT_MARKERS),
            "duplicate": list(DUPLICATE_MARKERS),
        },
        "factors": factors,
        "handSpecified": {
            "weights": {k: float(w) for k, w in zip(FEATURE_KEYS, hand)},
            "caps": noida,
        },
        "calibration": calibration,
        "reviewProbability": REVIEW_PROBABILITY,
        "evaluation": {
            "candidates": evaluation,
            "shippedVsHand": {"aucGap": round(gap, 4), "ciLow": round(low, 4), "ciHigh": round(high, 4)},
            "shippedVsPersistence": {
                "aucGap": round(p_gap, 4),
                "ciLow": round(p_low, 4),
                "ciHigh": round(p_high, 4),
            },
            "calibration": {
                "rawEce": round(expected_calibration_error(y, raw_p), 4),
                "rawBrier": round(brier(y, raw_p), 4),
                "calibratedEce": round(expected_calibration_error(y, calibrated), 4),
                "calibratedBrier": round(brier(y, calibrated), 4),
                "meanRaw": round(float(raw_p.mean()), 4),
                "meanCalibrated": round(float(np.nanmean(calibrated)), 4),
                "observed": round(float(y.mean()), 4),
            },
        },
    }

    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")

    out = panel[["agency", "board", "month", "requests", *FEATURE_KEYS, "nextBreachRate", "failed"]].copy()
    out["month"] = out["month"].astype(str)
    out["score"] = final_scores
    out["probability"] = iso.predict(final_scores)
    PANEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    # Full precision: the backend is checked against these to 1e-9, and ten
    # significant digits failed that on rounding alone.
    out.to_csv(PANEL_OUT, index=False, float_format="%.17g")
    results.to_csv(RESULTS_OUT)
    return spec


def run() -> dict:
    spec_v1 = load_spec()
    hand = np.array([spec_v1.weights(ENTITY_TYPE)[k] for k in FEATURE_KEYS], dtype=float)
    noida = {f.key: float(f.curve.cap) for f in spec_v1.factors(ENTITY_TYPE) if f.key in LINEAR}

    panel = build_panel()
    print("Phase 7 - GRIE for NYC")
    print(
        f"{len(panel):,} unit-months, {panel['failed'].mean():.1%} positive; "
        f"{N_REPEATS} x {N_SPLITS}-fold grouped by unit\n"
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        results, oof_mean, X, y, agency, groups = evaluate(panel, hand, noida)

    print(f"\n{'candidate':<14}{'CV AUC':>8}{'sd':>7}{'within-agency':>15}{'max at cap':>12}  factor")
    for name, row in results.iterrows():
        print(
            f"{name:<14}{row['test_auc']:>8.4f}{row['test_sd']:>7.4f}{row['within_agency_auc']:>15.4f}"
            f"{row['max_saturation']:>12.1%}  {row['saturated_factor']}"
        )
    chosen = choose(results)
    print(f"\nshipping: {chosen} (rule declared in the module docstring)")

    spec = export(panel, chosen, results, oof_mean, X, y, agency, groups, hand, noida)
    ev = spec["evaluation"]
    print(
        f"shipped vs hand-specified, paired bootstrap: {ev['shippedVsHand']['aucGap']:+.4f} "
        f"[{ev['shippedVsHand']['ciLow']:+.4f}, {ev['shippedVsHand']['ciHigh']:+.4f}]"
    )
    pv = ev["shippedVsPersistence"]
    print(
        f"shipped vs missed-deadlines alone: {pv['aucGap']:+.4f} [{pv['ciLow']:+.4f}, {pv['ciHigh']:+.4f}]"
        " - what the other four factors add"
    )
    c = ev["calibration"]
    print(
        f"calibration: raw ECE {c['rawEce']:.4f} (mean {c['meanRaw']:.3f}) -> isotonic ECE "
        f"{c['calibratedEce']:.4f} (mean {c['meanCalibrated']:.3f}); observed {c['observed']:.3f}"
    )
    print("weights: " + ", ".join(f"{f['key']} {f['weight']:.3f}" for f in spec["factors"]))
    print(f"\nwritten {SPEC_OUT.relative_to(ROOT)}, {PANEL_OUT.relative_to(ROOT)}")
    return spec


if __name__ == "__main__":
    run()
