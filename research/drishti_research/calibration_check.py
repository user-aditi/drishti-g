"""Does the score mean anything, and is the gap statistically real?

    python -m drishti_research.calibration_check

Two gaps in the evaluation
--------------------------
**Calibration.** Every number in the study so far is AUC, which measures
*ranking* only. An officer opening the risk register does not see a rank — they
see a score of 78, next to a sector, and they decide whether to send someone.
A model can rank perfectly and still be systematically overconfident, and a
scoring system that says 78 when the real failure probability is 25 will burn
inspection budget and then credibility. Ranking-only evaluation cannot see that.

Reported here: **Brier score** (mean squared error of the probability, lower is
better), and **expected calibration error** — the average gap between predicted
probability and observed frequency, computed over equal-count bins.

A caveat this study must state rather than hide: GRIE's raw output is a 0-100
governance score, not a probability, and it has never claimed to be one. Its
Brier score is therefore reported *after* the same monotone rescaling every
model gets, so the comparison is about the shape of the score rather than about
the units it happens to be expressed in.

**Statistical testing.** Bootstrap intervals on the AUC gap are reported
throughout, which is sound, but the paired comparison of two ROC curves on the
same cases has a standard exact treatment — DeLong's test — and its absence is
the kind of thing a methods reviewer notices immediately. It is implemented here
directly, since scikit-learn does not ship it.

**Power.** "The interval contains zero" is not the same statement as "there is
no effect", and a paper that reports the first while implying the second is
doing something dishonest. The minimum detectable effect at this sample size is
computed so the negative results can be stated with the precision they deserve.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.isotonic import IsotonicRegression
from sklearn.model_selection import StratifiedGroupKFold

from .bpic_signals import FEATURE_KEYS
from .bpic_signals import build_panel as build_2015
from .bpic2018_signals import build_panel as build_2018
from .bpic2018_signals import FEATURE_KEYS as FEATURE_KEYS_2018
from .bpic_study import _fold_scores

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

SEEDS = [11, 23, 37, 41, 53]

LABELS = {
    "grie": "GRIE (hand-specified)",
    "grie_tuned": "GRIE (tuned)",
    "logistic": "Logistic regression",
    "gbm": "Gradient boosting",
    "rf": "Random forest",
}

#: Equal-count bins for expected calibration error. Ten is conventional; with a
#: few hundred rows it leaves enough per bin for the observed frequency to mean
#: something.
N_BINS = 10


# --- DeLong's test -----------------------------------------------------------
# The standard exact test for two correlated ROC curves. Implemented from the
# fast algorithm of Sun & Xu (2014) rather than pulled in as a dependency: it is
# forty lines, and a reader checking the paper's statistics should be able to
# see them.


def _midrank(x: np.ndarray) -> np.ndarray:
    order = np.argsort(x)
    sorted_x = x[order]
    n = len(x)
    ranks = np.zeros(n)
    i = 0
    while i < n:
        j = i
        while j < n - 1 and sorted_x[j + 1] == sorted_x[i]:
            j += 1
        ranks[i : j + 1] = 0.5 * (i + j) + 1
        i = j + 1
    out = np.empty(n)
    out[order] = ranks
    return out


def delong_test(y: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Two correlated AUCs on the same cases. Returns (auc_a, auc_b, p-value)."""
    pos, neg = a[y == 1], a[y == 0]
    pos_b, neg_b = b[y == 1], b[y == 0]
    m, n = len(pos), len(neg)

    scores = np.vstack([np.concatenate([pos, neg]), np.concatenate([pos_b, neg_b])])
    k = scores.shape[0]

    tx = np.array([_midrank(scores[r, :m]) for r in range(k)])
    ty = np.array([_midrank(scores[r, m:]) for r in range(k)])
    tz = np.array([_midrank(scores[r, :]) for r in range(k)])

    aucs = (tz[:, :m].sum(axis=1) / m - (m + 1) / 2) / n
    v01 = (tz[:, :m] - tx) / n
    v10 = 1 - (tz[:, m:] - ty) / m

    s = np.cov(v01) / m + np.cov(v10) / n
    contrast = np.array([1, -1])
    var = contrast @ s @ contrast
    if var <= 0:
        return float(aucs[0]), float(aucs[1]), 1.0
    z = (aucs[0] - aucs[1]) / np.sqrt(var)
    return float(aucs[0]), float(aucs[1]), float(2 * stats.norm.sf(abs(z)))


# --- Calibration -------------------------------------------------------------


def _rescale(scores: np.ndarray) -> np.ndarray:
    """Min-max onto [0, 1], so every model is judged on the shape of its score.

    GRIE emits a 0-100 governance score and never claimed to be a probability.
    Comparing its raw output to a classifier's `predict_proba` on Brier score
    would be comparing units, not models.
    """
    lo, hi = np.nanmin(scores), np.nanmax(scores)
    return (scores - lo) / (hi - lo) if hi > lo else np.full_like(scores, 0.5)


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = N_BINS) -> float:
    """Mean |predicted - observed| over equal-count bins."""
    order = np.argsort(p)
    chunks = np.array_split(order, bins)
    total = 0.0
    for chunk in chunks:
        if len(chunk) == 0:
            continue
        total += len(chunk) * abs(p[chunk].mean() - y[chunk].mean())
    return float(total / len(y))


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def calibrate(
    y: np.ndarray, scores: np.ndarray, groups: np.ndarray, seed: int = 20260910
) -> np.ndarray:
    """Out-of-sample isotonic calibration of a raw score.

    AUC is invariant to any monotone transform, so a calibration layer cannot
    change how a model ranks — it can only change what its numbers mean. That
    makes this a free test of an important question: is the score *calibratable*,
    or is its shape wrong in a way no monotone map can fix?

    Fitted on four folds and applied to the fifth, grouped by unit, so no row is
    calibrated by a mapping that saw it.
    """
    out = np.full(len(y), np.nan)
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
    for train_idx, test_idx in splitter.split(scores.reshape(-1, 1), y, groups):
        model = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        model.fit(scores[train_idx], y[train_idx])
        out[test_idx] = model.predict(scores[test_idx])
    return out


# --- Power -------------------------------------------------------------------


def minimum_detectable_gap(
    y: np.ndarray, scores: np.ndarray, alpha: float = 0.05, power: float = 0.80
) -> float:
    """Smallest AUC difference this panel could have detected.

    Uses the Hanley-McNeil standard error for a single AUC, doubled for a paired
    comparison and reduced by the correlation between two models' scores, which
    is high here because they read the same five features. The result is a floor
    on what "no significant difference" is allowed to mean.
    """
    n1 = int(y.sum())
    n0 = int((1 - y).sum())
    auc = 0.75  # a representative value; the SE is not very sensitive to it
    q1 = auc / (2 - auc)
    q2 = 2 * auc**2 / (1 + auc)
    se = np.sqrt(
        (auc * (1 - auc) + (n1 - 1) * (q1 - auc**2) + (n0 - 1) * (q2 - auc**2)) / (n1 * n0)
    )
    # Paired: two correlated estimates. r = 0.8 is conservative for models
    # sharing a feature set.
    se_diff = se * np.sqrt(2 * (1 - 0.8))
    z_a, z_b = stats.norm.isf(alpha / 2), stats.norm.isf(1 - power)
    return float((z_a + z_b) * se_diff)


# --- Runner ------------------------------------------------------------------


def _pooled_oof(panel: pd.DataFrame, features: list[str], groups: np.ndarray):
    X = panel[features].astype(float).reset_index(drop=True)
    y = panel["failed"].to_numpy()
    stacked: dict[str, list[np.ndarray]] = {n: [] for n in LABELS}
    for seed in SEEDS:
        _, oof = _fold_scores(X, y, groups, seed)
        for name, scores in oof.items():
            stacked[name].append(scores)
    return {n: np.nanmean(np.vstack(v), axis=0) for n, v in stacked.items()}, y


def run(which: str = "2015") -> pd.DataFrame:
    if which == "2015":
        panel = build_2015()
        groups = (panel["municipality"].astype(str) + "/" + panel["owner"].astype(str)).to_numpy()
        features = FEATURE_KEYS
    else:
        panel = build_2018()
        groups = panel["unit"].to_numpy()
        features = FEATURE_KEYS_2018

    oof, y = _pooled_oof(panel, features, groups)

    rows = []
    for name, label in LABELS.items():
        valid = ~np.isnan(oof[name])
        p = _rescale(oof[name][valid])
        yy, gg = y[valid], groups[valid]

        # The same score after an out-of-sample monotone map. Ranking, and so
        # AUC, is untouched by construction.
        cal = calibrate(yy, p, gg)
        ok = ~np.isnan(cal)

        rows.append(
            {
                "panel": which,
                "model": label,
                "brier": brier(yy, p),
                "ece": expected_calibration_error(yy, p),
                "brier_calibrated": brier(yy[ok], cal[ok]),
                "ece_calibrated": expected_calibration_error(yy[ok], cal[ok]),
                "mean_predicted": float(p.mean()),
                "observed_rate": float(yy.mean()),
            }
        )
    frame = pd.DataFrame(rows)
    frame.attrs["oof"] = oof
    frame.attrs["y"] = y
    return frame


def report(frame: pd.DataFrame) -> None:
    which = frame["panel"].iloc[0]
    oof, y = frame.attrs["oof"], frame.attrs["y"]

    print(f"--- BPIC {which}: calibration and significance ---\n")

    print(f"  {'model':<24}{'Brier':>9}{'ECE':>9}"
          f"{'Brier cal':>11}{'ECE cal':>10}{'mean pred':>12}")
    for _, r in frame.iterrows():
        print(f"  {r.model:<24}{r.brier:>9.4f}{r.ece:>9.4f}"
              f"{r.brier_calibrated:>11.4f}{r.ece_calibrated:>10.4f}"
              f"{r.mean_predicted:>12.3f}")
    print(f"  {'(observed rate)':<24}{'':>9}{'':>9}{'':>11}{'':>10}"
          f"{frame.observed_rate.iloc[0]:>12.3f}")

    print("\n  DeLong test against GRIE (paired, same cases):")
    for name in ("gbm", "rf", "logistic", "grie_tuned"):
        valid = ~(np.isnan(oof["grie"]) | np.isnan(oof[name]))
        a, b, p = delong_test(y[valid], oof["grie"][valid], oof[name][valid])
        stars = "significant" if p < 0.05 else "not significant"
        print(f"    GRIE - {LABELS[name]:<22}{a - b:+.4f}   p = {p:.4f}   {stars}")

    mdg = minimum_detectable_gap(y, oof["grie"])
    print(f"\n  Minimum detectable gap at n = {len(y)} "
          f"({int(y.sum())} positive), 80% power, alpha 0.05: {mdg:.4f} AUC")
    print("  Any reported null must be read against this: a gap smaller than it")
    print("  would not have been detected by this panel whether or not it exists.")


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    frames = []
    for which in ("2015", "2018"):
        frame = run(which)
        report(frame)
        print()
        frames.append(frame)
    out = RESULTS / "calibration.csv"
    # Drop the attached arrays first: concat tries to reconcile `attrs` across
    # frames and the two panels have different row counts.
    for f in frames:
        f.attrs.clear()
    pd.concat(frames, ignore_index=True).to_csv(out, index=False)
    print(f"  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
