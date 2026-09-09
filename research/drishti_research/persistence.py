"""Does the interpretability advantage depend on how persistent the target is?

    python -m drishti_research.persistence

The question
------------
Two panels gave opposite answers and the study currently reports them as two
anecdotes. BPIC 2015: the target's lag-1 autocorrelation is +0.702, and the
hand-specified model beats every fitted one. BPIC 2018: autocorrelation +0.141,
and nothing clears chance by much. Same panel sizes, same class balance, same
five signals, same fold routine.

That pairing suggests a mechanism — governance risk forecasting needs a target
that persists, and where unit performance is memoryless there is nothing for any
model to find — but two points do not make a relationship. This module tests it
as one: pool the units from both panels, measure each unit's own target
persistence, and ask how the between-model gap moves across persistence.

What is and is not circular here
--------------------------------
**Absolute AUC must rise with persistence, and that is not a finding.** The
label is a threshold on next period's breach rate and the current breach rate is
a feature, so a unit whose rate persists is mechanically easier to forecast. Any
model gets that for free. Reporting "AUC increases with autocorrelation" as a
result would be reporting the definition of autocorrelation.

**The gap between models is the finding.** Persistence raises the ceiling for
everyone; whether the *ordering* between a hand-specified model and a fitted one
changes across that range is a separate question with no mechanical answer. If
the gap is flat, the two panels differed by luck and the scope condition is
unsupported. If it widens with persistence, the study has a quantitative
statement to make instead of two case studies.

Why the units are pooled across organisations
---------------------------------------------
Bucketing within one panel would confound persistence with organisation, since
BPIC 2015's units are systematically more persistent than BPIC 2018's. Pooling
puts units from both on one axis so the buckets are defined by the property
under test rather than by which log a unit came from. Each bucket's composition
is reported, because a bucket that turns out to be all one panel is measuring
the organisation again and must be read that way.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold

from .bpic_signals import FEATURE_KEYS
from .bpic_signals import build_panel as build_2015
from .bpic2018_signals import build_panel as build_2018
from .bpic_study import build_logistic, small_data_black_box, small_data_forest
from .model_spec import load_spec
from .models import InterpretableScorer
from .tuning import tune_weights

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results"

ENTITY = "SECTOR"

#: A unit needs this many periods before its own autocorrelation means anything.
MIN_PERIODS = 4

#: Repeats of grouped k-fold inside each bucket, to average over split luck.
SEEDS = [11, 23, 37, 41, 53]
N_SPLITS = 4

GRIE = "GRIE (hand-specified)"
BOOSTING = "Gradient boosting"
FOREST = "Random forest"
LOGISTIC = "Logistic regression"


def pooled_panel() -> pd.DataFrame:
    """Both panels stacked, with each unit's own target persistence attached."""
    a = build_2015()
    a = a.assign(
        unit="2015:" + a["municipality"].astype(str) + "/" + a["owner"].astype(str),
        panel="BPIC 2015",
    )
    b = build_2018()
    b = b.assign(unit="2018:" + b["unit"].astype(str), panel="BPIC 2018")

    # slaBreachRate is already in FEATURE_KEYS; naming it twice here silently
    # produces a duplicated column, and the groupby below then sees a frame.
    keep = FEATURE_KEYS + ["failed", "unit", "panel", "quarter"]
    pooled = pd.concat([a[keep], b[keep]], ignore_index=True)

    counts = pooled.groupby("unit", observed=True)["failed"].size()
    pooled = pooled[pooled["unit"].isin(counts[counts >= MIN_PERIODS].index)].copy()

    # Each unit's lag-1 autocorrelation of its own breach rate. Noisy on four
    # points, which is why units are bucketed rather than ranked individually:
    # the bucket's pooled autocorrelation is the quantity actually reported.
    def autocorr(series: pd.Series) -> float:
        s = series.to_numpy(dtype=float)
        if len(s) < 2 or np.std(s[:-1]) == 0 or np.std(s[1:]) == 0:
            return 0.0
        return float(np.corrcoef(s[:-1], s[1:])[0, 1])

    pooled = pooled.sort_values(["unit", "quarter"], kind="stable")
    ac = pooled.groupby("unit", observed=True)["slaBreachRate"].apply(autocorr)
    pooled["persistence"] = pooled["unit"].map(ac)
    return pooled.reset_index(drop=True)


def _compare(frame: pd.DataFrame) -> dict[str, float]:
    """Pooled out-of-fold AUC per model, inside one bucket."""
    spec = load_spec()
    X = frame[FEATURE_KEYS].astype(float).reset_index(drop=True)
    y = frame["failed"].to_numpy()
    groups = frame["unit"].to_numpy()

    names = (GRIE, LOGISTIC, FOREST, BOOSTING)
    stacked: dict[str, list[np.ndarray]] = {n: [] for n in names}

    for seed in SEEDS:
        oof = {n: np.full(len(y), np.nan) for n in names}
        splitter = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=seed)
        for train_idx, test_idx in splitter.split(X, y, groups):
            if len(np.unique(y[test_idx])) < 2:
                continue
            X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
            y_train = y[train_idx]

            grie = InterpretableScorer(spec, ENTITY)
            oof[GRIE][test_idx] = grie.predict_proba(X_test)[:, 1]

            for name, builder in (
                (LOGISTIC, build_logistic),
                (FOREST, small_data_forest),
                (BOOSTING, small_data_black_box),
            ):
                estimator = builder(seed)
                fit_kwargs = (
                    {"groups": groups[train_idx]} if isinstance(estimator, GridSearchCV) else {}
                )
                model = estimator.fit(X_train, y_train, **fit_kwargs)
                oof[name][test_idx] = model.predict_proba(X_test)[:, 1]

        for name in names:
            stacked[name].append(oof[name])

    out = {}
    for name in names:
        scores = np.nanmean(np.vstack(stacked[name]), axis=0)
        valid = ~np.isnan(scores)
        out[name] = roc_auc_score(y[valid], scores[valid]) if len(np.unique(y[valid])) > 1 else np.nan
    return out


def run(n_buckets: int = 3) -> pd.DataFrame:
    pooled = pooled_panel()

    units = pooled.drop_duplicates("unit")[["unit", "persistence", "panel"]]
    units = units.sort_values("persistence", kind="stable")
    units["bucket"] = pd.qcut(
        units["persistence"].rank(method="first"), n_buckets, labels=range(n_buckets)
    )
    pooled = pooled.merge(units[["unit", "bucket"]], on="unit", how="left")

    rows = []
    for bucket, frame in pooled.groupby("bucket", observed=True):
        # The bucket's pooled autocorrelation: computed over every consecutive
        # pair in the bucket rather than averaging noisy per-unit estimates.
        pairs = []
        for _, unit_frame in frame.sort_values(["unit", "quarter"]).groupby("unit", observed=True):
            s = unit_frame["slaBreachRate"].to_numpy(dtype=float)
            pairs.extend(zip(s[:-1], s[1:]))
        arr = np.array(pairs)
        pooled_ac = (
            float(np.corrcoef(arr[:, 0], arr[:, 1])[0, 1])
            if len(arr) > 2 and np.std(arr[:, 0]) > 0 and np.std(arr[:, 1]) > 0
            else np.nan
        )

        scores = _compare(frame)
        share_2015 = float((frame["panel"] == "BPIC 2015").mean())
        rows.append(
            {
                "bucket": int(bucket),
                "pooled_autocorr": pooled_ac,
                "rows": len(frame),
                "units": frame["unit"].nunique(),
                "positive_rate": float(frame["failed"].mean()),
                "share_2015": share_2015,
                **scores,
            }
        )

    out = pd.DataFrame(rows)
    out["gap_vs_boosting"] = out[GRIE] - out[BOOSTING]
    out["gap_vs_forest"] = out[GRIE] - out[FOREST]
    out["gap_vs_logistic"] = out[GRIE] - out[LOGISTIC]
    return out


def report(frame: pd.DataFrame) -> None:
    print("--- does the advantage track target persistence? ---\n")
    print(f"  {'bucket':>7}{'autocorr':>10}{'rows':>7}{'units':>7}"
          f"{'2015 share':>12}{'GRIE':>9}{'GBM':>9}{'gap':>9}")
    for _, r in frame.iterrows():
        print(f"  {r.bucket:>7}{r.pooled_autocorr:>10.3f}{r.rows:>7.0f}{r.units:>7.0f}"
              f"{r.share_2015:>11.0%}{r[GRIE]:>9.4f}{r[BOOSTING]:>9.4f}"
              f"{r.gap_vs_boosting:>+9.4f}")

    print("\n  full model table:")
    for _, r in frame.iterrows():
        print(f"    bucket {r.bucket} (autocorr {r.pooled_autocorr:+.3f}):")
        for name in (GRIE, LOGISTIC, FOREST, BOOSTING):
            print(f"      {name:<24}{r[name]:.4f}")

    lo, hi = frame.iloc[0], frame.iloc[-1]
    print(f"\n  lowest-persistence bucket  ({lo.pooled_autocorr:+.3f}): "
          f"GRIE - GBM = {lo.gap_vs_boosting:+.4f}")
    print(f"  highest-persistence bucket ({hi.pooled_autocorr:+.3f}): "
          f"GRIE - GBM = {hi.gap_vs_boosting:+.4f}")

    # Rank correlation across buckets: with three points this is direction, not
    # a p-value, and it is reported as such.
    trend = np.corrcoef(frame["pooled_autocorr"], frame["gap_vs_boosting"])[0, 1]
    print(f"\n  correlation(persistence, gap) across buckets = {trend:+.3f}")

    print()
    if hi.gap_vs_boosting > lo.gap_vs_boosting and trend > 0.5:
        print("  The gap WIDENS with persistence. The two panels are two points on")
        print("  one relationship rather than a win and a loss, and the paper can")
        print("  state a scope condition instead of reporting an anomaly.")
    elif abs(hi.gap_vs_boosting - lo.gap_vs_boosting) < 0.02:
        print("  The gap is FLAT across persistence. The scope condition is not")
        print("  supported: the two panels differed for some other reason, and the")
        print("  paper must not claim persistence explains it.")
    else:
        print("  No clean trend. Report the buckets and draw no mechanism from them.")

    if frame["share_2015"].max() > 0.9 or frame["share_2015"].min() < 0.1:
        print("\n  CAUTION: at least one bucket is nearly all one panel, so it is")
        print("  measuring the organisation as much as the persistence.")


def main() -> None:
    frame = run()
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / "persistence.csv"
    frame.to_csv(out, index=False)
    report(frame)
    print(f"\n  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
