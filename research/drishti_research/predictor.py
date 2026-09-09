"""Train the next-action predictor, and export it for TypeScript to run.

    python -m drishti_research.predictor

Given what has happened to a complaint so far, what happens next and how sure
are we. The confidence is the point: the autonomy gate in Wave 4 decides whether
an action may execute without a human by thresholding on it, so a score that
does not separate reliable predictions from unreliable ones makes the whole gate
theatre.

Why counting, and why that is a choice rather than a shortcut
-------------------------------------------------------------
The model is a frequency table: for each prefix of activities, the distribution
over what came next, backed off to shorter prefixes when a prefix is unseen.
Weytjens and Weber (BPM 2026) showed this matches billion-parameter models on
next-activity prediction, so it is a defensible baseline with a citation
attached rather than a placeholder.

It also has a property no neural model has: **every prediction can be explained
by pointing at the cases it came from.** For a system whose stated value is that
it explains itself to the officer it is advising, that is not a small thing.

The comparison against a learned model is run here too, so the claim is
measured rather than assumed.

What this corpus can and cannot support
---------------------------------------
The complaint lifecycle is a nine-state machine with constrained transitions, so
unlike free text the space of legal traces is genuinely small — 24 variants and
34 distinct prefixes across 1,255 cases is not obviously too few, it may simply
be what the domain looks like.

The measurement that matters is whether the task is *hard enough to be worth
predicting*. It is: overall accuracy sits around 0.77, and the confidence is
monotone across bands — high-confidence prefixes score ~0.98 and low-confidence
ones ~0.13. That spread is what Wave 4 needs, and it is the reason this module
shipped where the classifier did not.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / "research" / "data" / "event-log.csv"
SPEC_OUT = ROOT / "backend" / "data" / "predictor-spec.json"

MODEL_VERSION = "pred-v1-counting"

#: Bump alongside predictor.ts whenever the backoff, the ordering or the shape
#: of the exported table changes.
CONTRACT = "pred/counting-backoff/1"

#: Longest prefix the table keeps. Beyond this the tail carries no cases and
#: only inflates the exported spec.
MAX_ORDER = 4

#: Emitted when a case ends. A real token, not a null: "nothing follows" is a
#: prediction the gate must be able to make and be scored on.
END = "<END>"


def load_traces() -> dict[str, list[str]]:
    if not LOG.exists():
        raise SystemExit(
            f"No event log at {LOG}.\n"
            "Run:  cd backend && npm run export:eventlog"
        )

    frame = pd.read_csv(LOG)
    frame = frame.sort_values(["case_id", "timestamp"], kind="stable")

    traces: dict[str, list[str]] = defaultdict(list)
    for case_id, activity in zip(frame["case_id"], frame["activity"], strict=True):
        traces[str(case_id)].append(str(activity))
    return dict(traces)


def split_by_case(traces: dict[str, list[str]], holdout: float = 0.3):
    """Split by case, never by prefix.

    A prefix-level split puts the first four events of a case in training and
    the fifth in test, which leaks the answer: the model has already seen the
    case it is being asked about. Every reported number in process-mining work
    depends on this being done right, and it is the single easiest thing to get
    wrong.
    """
    keys = sorted(traces)
    cut = int(len(keys) * (1 - holdout))
    return keys[:cut], keys[cut:]


def build_table(traces: dict[str, list[str]], case_ids: list[str]) -> dict[str, Counter]:
    """prefix -> Counter over the activity that followed it."""
    table: dict[str, Counter] = defaultdict(Counter)

    for case_id in case_ids:
        trace = traces[case_id]
        for i, _ in enumerate(trace):
            following = trace[i + 1] if i + 1 < len(trace) else END
            # Every suffix of the prefix ending at i, up to MAX_ORDER, so the
            # backoff has somewhere to land.
            lowest = max(0, i - MAX_ORDER + 1)
            for k in range(lowest, i + 1):
                table[">".join(trace[k : i + 1])].update([following])
        # The empty prefix predicts how cases begin.
        table[""].update([trace[0]])

    return table


def predict(table: dict[str, Counter], prefix: list[str]) -> tuple[str, float, int] | None:
    """Longest matching suffix wins; fall back to shorter ones, then to nothing.

    Returns the activity, its share of the distribution, and how many cases that
    share was computed from — the support matters, because 1.0 from two cases
    and 1.0 from two hundred are not the same claim.
    """
    window = prefix[-MAX_ORDER:]
    for k in range(len(window)):
        dist = table.get(">".join(window[k:]))
        if not dist:
            continue
        total = sum(dist.values())
        activity, count = dist.most_common(1)[0]
        return activity, count / total, total
    return None


def evaluate(table: dict[str, Counter], traces: dict[str, list[str]], case_ids: list[str]):
    scored = 0
    correct = 0
    bands: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    for case_id in case_ids:
        trace = traces[case_id]
        for i, _ in enumerate(trace):
            truth = trace[i + 1] if i + 1 < len(trace) else END
            guess = predict(table, trace[: i + 1])
            if guess is None:
                continue
            activity, confidence, _support = guess
            scored += 1
            hit = activity == truth
            correct += hit

            band = (
                "0.95-1.00" if confidence >= 0.95
                else "0.80-0.95" if confidence >= 0.80
                else "0.60-0.80" if confidence >= 0.60
                else "0.00-0.60"
            )
            bands[band][0] += 1
            bands[band][1] += hit

    return scored, correct, bands


def learned_comparison(traces: dict[str, list[str]], train_ids, test_ids) -> float | None:
    """A learned model on the same split, so "counting is enough" is measured.

    Gradient boosting over a bag-of-activities encoding of the prefix. Not an
    LSTM — that would need torch, which this project does not carry, and the
    honest note is that the deep comparison the paper wants is still outstanding.
    What this settles is whether a *learned* model beats counting at all here.
    """
    try:
        from sklearn.ensemble import HistGradientBoostingClassifier
    except ImportError:
        return None

    alphabet = sorted({a for t in traces.values() for a in t})
    index = {a: i for i, a in enumerate(alphabet)}

    def featurise(prefix: list[str]) -> list[float]:
        counts = [0.0] * len(alphabet)
        for a in prefix:
            counts[index[a]] += 1
        last = [0.0] * len(alphabet)
        if prefix:
            last[index[prefix[-1]]] = 1.0
        return counts + last + [float(len(prefix))]

    def rows(case_ids):
        x, y = [], []
        for case_id in case_ids:
            trace = traces[case_id]
            for i, _ in enumerate(trace):
                x.append(featurise(trace[: i + 1]))
                y.append(trace[i + 1] if i + 1 < len(trace) else END)
        return np.array(x), np.array(y)

    x_train, y_train = rows(train_ids)
    x_test, y_test = rows(test_ids)

    model = HistGradientBoostingClassifier(max_iter=200, random_state=20260909)
    model.fit(x_train, y_train)
    return float((model.predict(x_test) == y_test).mean())


def main() -> None:
    traces = load_traces()
    train_ids, test_ids = split_by_case(traces)

    variants = len({">".join(t) for t in traces.values()})
    print(f"--- next-action predictor --- {len(traces)} cases, {variants} distinct variants")
    print(f"    {len(train_ids)} train / {len(test_ids)} held out, split by case")
    print()

    table = build_table(traces, train_ids)
    scored, correct, bands = evaluate(table, traces, test_ids)
    accuracy = correct / scored

    print(f"  counting model   {accuracy:.3f}   on {scored} held-out prefixes")

    learned = learned_comparison(traces, train_ids, test_ids)
    if learned is not None:
        print(f"  gradient boosting {learned:.3f}")
        print(f"  difference        {learned - accuracy:+.3f}")
        if learned <= accuracy + 0.01:
            print("  -> counting is not beaten. Shipping the explainable model costs nothing.")
        else:
            print("  -> the learned model is ahead; worth recording in the paper.")
    print()

    # --- calibration -------------------------------------------------------
    #
    # The number Wave 4 depends on. A gate thresholds on confidence, so what
    # matters is not overall accuracy but whether high confidence really is more
    # reliable than low. If these bands are flat, the gate cannot work.
    print("  confidence   n      accuracy")
    for key in ["0.95-1.00", "0.80-0.95", "0.60-0.80", "0.00-0.60"]:
        n, hits = bands.get(key, [0, 0])
        if n == 0:
            continue
        print(f"  {key}  {n:>5}  {hits / n:.3f}")
    print()

    export(table, traces, accuracy, learned, len(train_ids))


def export(
    table: dict[str, Counter],
    traces: dict[str, list[str]],
    accuracy: float,
    learned: float | None,
    trained_on: int,
) -> None:
    """Retrain on everything, then write the table as JSON.

    Evaluation used a held-out split; the shipped model uses every case, because
    withholding thirty percent of the evidence from production to preserve a
    measurement would be the wrong trade.
    """
    full = build_table(traces, sorted(traces))

    distributions = {
        prefix: {activity: count for activity, count in dist.most_common()}
        for prefix, dist in full.items()
    }

    spec = {
        "contract": CONTRACT,
        "modelVersion": MODEL_VERSION,
        "trainedAt": pd.Timestamp.utcnow().isoformat(),
        "trainedOnCases": len(traces),
        "evaluatedOnCases": trained_on,
        "maxOrder": MAX_ORDER,
        "endToken": END,
        "accuracy": round(float(accuracy), 4),
        "learnedComparisonAccuracy": None if learned is None else round(float(learned), 4),
        "alphabet": sorted({a for t in traces.values() for a in t}),
        "distributions": distributions,
    }

    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec), encoding="utf-8")
    print(f"  wrote {SPEC_OUT.relative_to(ROOT)} ({SPEC_OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(distributions)} prefixes over {len(spec['alphabet'])} activities")

    write_fixture(full, traces)


def write_fixture(table: dict[str, Counter], traces: dict[str, list[str]]) -> None:
    """Cases the TypeScript predictor must reproduce exactly."""
    cases = []
    for trace in list(traces.values())[:40]:
        for i in range(min(len(trace), 3)):
            prefix = trace[: i + 1]
            guess = predict(table, prefix)
            if guess is None:
                continue
            activity, confidence, support = guess
            cases.append(
                {
                    "prefix": prefix,
                    "expectedAction": activity,
                    "expectedProbability": round(confidence, 9),
                    "expectedSupport": support,
                }
            )
        if len(cases) >= 20:
            break

    out = ROOT / "backend" / "tests" / "fixtures" / "predictor-cases.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cases, indent=2), encoding="utf-8")
    print(f"  wrote {out.relative_to(ROOT)} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
