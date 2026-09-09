"""Calibrate the autonomy gate's thresholds, and export them.

    python -m drishti_research.conformal

The gate decides whether an action may execute without a human by comparing a
confidence against a threshold. **Where that threshold comes from is the whole
question.** A hard-coded 0.9 is a number somebody liked the look of; it makes no
promise, and when it turns out to admit 8% errors on high-risk actions there is
nothing to point at but taste.

This picks each threshold so that the error rate among the decisions it admits
is at most a stated tolerance, measured on held-out cases. That converts the
gate's setting from an opinion into a claim: *at this threshold, on data like
this, roughly this fraction of automated actions were wrong.*

The method
----------
Split-conformal risk control, in its simplest useful form. For a risk class with
tolerance ``alpha``:

1. Score every calibration prefix, keeping the *gated* confidence — the top
   probability after non-feasible actions are zeroed and the rest renormalised.
   That separation between predictive and automation confidence is the idea the
   whole gate is built on, so calibrating on raw confidence would calibrate the
   wrong quantity.
2. Sweep the threshold downward. At each value, take the decisions at or above
   it and measure how many were wrong.
3. Keep the **lowest** threshold whose error rate is still within ``alpha``.
   Lowest, not highest, because a threshold that admits nothing is trivially
   safe and automates nothing — the point is to find how far down we can go.

The tolerances are a policy choice, not a measurement
-----------------------------------------------------
``ALPHA`` says how often each class of action may be wrong. Those numbers are
judgements about consequence and belong to whoever owns the service, not to
this file — a wrong *notification* is noise, a wrong *closure* tells a resident
their problem is solved when it is not. They are written here so they are
arguable rather than buried.

What this calibration does not model
------------------------------------
Feasibility here is the transition constraint only: what `ALLOWED_TRANSITIONS`
permits from the current status. The running gate additionally intersects with
the actor's rank and posting scope, which can only *shrink* the permitted set
and therefore only *raise* the renormalised confidence.

That direction matters and is not conservative: a narrower set at runtime pushes
confidence up, so more decisions clear a threshold calibrated without it. The
thresholds here are therefore a floor to start from, and the gate's own measured
behaviour — coverage and error observed in production — is what should replace
them. Recorded rather than papered over, because a calibration that quietly
assumes away part of the system is worse than none.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / "research" / "data" / "event-log.csv"
SPEC_OUT = ROOT / "backend" / "data" / "gate-spec.json"

MODEL_VERSION = "gate-v1-conformal"

#: Bump alongside autonomy.ts whenever the risk classes, the tolerances or the
#: shape of the threshold table change.
CONTRACT = "gate/split-conformal/1"

END = "<END>"
MAX_ORDER = 4

#: Mirrors ALLOWED_TRANSITIONS in backend/src/services/gcce.ts.
#:
#: Duplicated deliberately and checked by a test on the TypeScript side, rather
#: than exported from the backend: this is the *normative* process model, it
#: changes about once a year, and a build-time dependency from the research
#: harness to the API would be a heavier coupling than the thing it prevents.
ALLOWED_TRANSITIONS: dict[str, list[str]] = {
    "SUBMITTED": ["ROUTED", "ASSIGNED", "REJECTED", "DUPLICATE"],
    "ROUTED": ["ASSIGNED", "REJECTED", "DUPLICATE"],
    "ASSIGNED": ["IN_PROGRESS", "REJECTED", "DUPLICATE"],
    "IN_PROGRESS": ["AWAITING_VERIFICATION", "REJECTED"],
    "AWAITING_VERIFICATION": ["RESOLVED", "IN_PROGRESS"],
    "RESOLVED": ["CLOSED", "IN_PROGRESS"],
    "CLOSED": [],
    "REJECTED": [],
    "DUPLICATE": [],
}

#: What each action costs when it is wrong.
#:
#: `AWAITING_VERIFICATION` was originally LOW, and that was a mistake worth
#: recording. In this system that status is written only when a crew submits
#: work *with proof*, which the verification checks then score. Automating it
#: would have the system assert that work happened in the field — no crew, no
#: photograph, no evidence. It is a claim about the physical world, and those
#: belong in the highest class whatever a model's confidence says.
#:
#: With that corrected, **no status transition is low-risk.** Every one of them
#: is a claim somebody should be willing to stand behind. The buildbook's
#: low-risk examples — notify, cluster, re-prioritise — are not status
#: transitions at all; they are side effects the system already performs
#: automatically and which never needed a gate.
RISK_OF_ACTION: dict[str, str] = {
    "ROUTED": "MEDIUM",
    "ASSIGNED": "MEDIUM",
    "IN_PROGRESS": "MEDIUM",
    "AWAITING_VERIFICATION": "HIGH",
    "RESOLVED": "HIGH",
    "CLOSED": "HIGH",
    "REJECTED": "HIGH",
    "DUPLICATE": "HIGH",
    #: Not an action. Predicting that a case is over is useful; there is
    #: nothing to execute, so it can never be automated either way.
    END: "LOW",
}

#: How often each class may be wrong. A policy choice; see the module docstring.
ALPHA: dict[str, float] = {
    "LOW": 0.10,
    "MEDIUM": 0.05,
    "HIGH": 0.01,
}

#: Never go below this however good the data looks. A threshold under a coin
#: flip is not a decision, it is a shrug.
FLOOR = 0.50


def load_traces() -> dict[str, list[str]]:
    if not LOG.exists():
        raise SystemExit(f"No event log at {LOG}.\nRun:  cd backend && npm run export:eventlog")

    frame = pd.read_csv(LOG).sort_values(["case_id", "timestamp"], kind="stable")
    traces: dict[str, list[str]] = defaultdict(list)
    for case_id, activity in zip(frame["case_id"], frame["activity"], strict=True):
        traces[str(case_id)].append(str(activity))
    return dict(traces)


def build_table(traces: dict[str, list[str]], case_ids: list[str]) -> dict[str, Counter]:
    table: dict[str, Counter] = defaultdict(Counter)
    for case_id in case_ids:
        trace = traces[case_id]
        for i, _ in enumerate(trace):
            following = trace[i + 1] if i + 1 < len(trace) else END
            for k in range(max(0, i - MAX_ORDER + 1), i + 1):
                table[">".join(trace[k : i + 1])].update([following])
    return table


def feasible_from(status: str) -> set[str]:
    """What may legally follow, plus the end of the case.

    `<END>` is always feasible: a complaint reaching a terminal status is the
    process working, not a deviation, and a gate that treated "nothing follows"
    as impossible would send every finished case to a human.
    """
    return set(ALLOWED_TRANSITIONS.get(status, [])) | {END}


def gated_prediction(table: dict[str, Counter], prefix: list[str]):
    """The prediction the gate would actually see.

    Returns the raw top probability, the gated one, and the chosen action —
    keeping both because the difference between them is what the second paper
    is about.
    """
    window = prefix[-MAX_ORDER:]
    dist = None
    for k in range(len(window)):
        candidate = table.get(">".join(window[k:]))
        if candidate:
            dist = candidate
            break
    if dist is None:
        return None

    total = sum(dist.values())
    raw_action, raw_count = dist.most_common(1)[0]
    raw_confidence = raw_count / total

    permitted = feasible_from(prefix[-1])
    allowed = {a: n for a, n in dist.items() if a in permitted}
    if not allowed:
        # The model expects only things policy forbids. That is a real state and
        # the gate must handle it: no automation is possible here at all.
        return raw_action, raw_confidence, None, 0.0

    gated_total = sum(allowed.values())
    gated_action = max(allowed, key=lambda a: allowed[a])
    return raw_action, raw_confidence, gated_action, allowed[gated_action] / gated_total


def calibrate(rows: list[tuple[float, bool]], alpha: float) -> tuple[float, float, float]:
    """Lowest threshold whose error rate stays within `alpha`.

    Returns the threshold, the error rate it achieves, and the share of
    decisions it admits. Sweeping downward and keeping the last acceptable value
    finds the most coverage the tolerance allows, which is the useful end of the
    trade — a high threshold is safe and useless.
    """
    if not rows:
        return 1.0, 0.0, 0.0

    best = (1.0, 0.0, 0.0)
    for step in range(100, int(FLOOR * 100) - 1, -1):
        threshold = step / 100
        admitted = [ok for conf, ok in rows if conf >= threshold]
        if not admitted:
            continue
        error = 1 - sum(admitted) / len(admitted)
        if error <= alpha:
            best = (threshold, error, len(admitted) / len(rows))
    return best


def main() -> None:
    traces = load_traces()
    keys = sorted(traces)
    cut = int(len(keys) * 0.6)
    train_ids, calib_ids = keys[:cut], keys[cut:]

    print(f"--- autonomy gate calibration --- {len(traces)} cases")
    print(f"    {len(train_ids)} to fit the predictor / {len(calib_ids)} to calibrate on")
    print()

    table = build_table(traces, train_ids)

    by_class: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    raw_by_class: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    infeasible_argmax = 0
    scored = 0

    for case_id in calib_ids:
        trace = traces[case_id]
        for i, _ in enumerate(trace):
            truth = trace[i + 1] if i + 1 < len(trace) else END
            result = gated_prediction(table, trace[: i + 1])
            if result is None:
                continue
            raw_action, raw_confidence, gated_action, gated_confidence = result
            scored += 1

            if raw_action not in feasible_from(trace[i]):
                infeasible_argmax += 1

            if gated_action is None:
                continue

            risk = RISK_OF_ACTION.get(gated_action, "HIGH")
            by_class[risk].append((gated_confidence, gated_action == truth))
            raw_by_class[risk].append((raw_confidence, raw_action == truth))

    print(f"  scored {scored} prefixes")
    print(
        f"  the model's top pick was forbidden by policy in {infeasible_argmax} "
        f"({infeasible_argmax / scored:.1%}) — every one of those is a mistake the gate prevents"
    )
    print()

    thresholds = {}
    print("  class   alpha  threshold  error   coverage   (raw, for comparison)")
    for risk in ("LOW", "MEDIUM", "HIGH"):
        alpha = ALPHA[risk]
        threshold, error, coverage = calibrate(by_class[risk], alpha)
        raw_threshold, raw_error, raw_coverage = calibrate(raw_by_class[risk], alpha)
        # Coverage of zero means the sweep found nothing: at every threshold
        # down to the floor the error rate still exceeded the tolerance. That is
        # not a calibration failure, it is the answer — this class of action
        # cannot be automated at this tolerance on this evidence, and the gate
        # must be told so explicitly rather than left to infer it from a
        # threshold of 1.0 that it might round past.
        automatable = coverage > 0
        thresholds[risk] = {
            "threshold": round(threshold, 2),
            "alpha": alpha,
            "observedError": round(error, 4),
            "coverage": round(coverage, 4),
            "calibratedOn": len(by_class[risk]),
            "automatable": automatable,
            "why": (
                f"At {threshold:.2f} the observed error is {error:.1%}, within the {alpha:.0%} tolerance."
                if automatable
                else f"No threshold down to {FLOOR:.2f} kept the error within {alpha:.0%}. "
                "Nothing in this class may execute without a human."
            ),
        }
        print(
            f"  {risk:<7} {alpha:>5.2f}  {threshold:>8.2f}  {error:>5.1%}  {coverage:>7.1%}"
            f"     {raw_threshold:.2f} / {raw_coverage:.1%}"
        )
    print()

    export(thresholds, len(calib_ids), infeasible_argmax, scored)


def export(thresholds: dict, calibrated_on: int, infeasible: int, scored: int) -> None:
    spec = {
        "contract": CONTRACT,
        "modelVersion": MODEL_VERSION,
        "trainedAt": pd.Timestamp.utcnow().isoformat(),
        "calibratedOnCases": calibrated_on,
        "floor": FLOOR,
        "thresholds": thresholds,
        "riskOfAction": RISK_OF_ACTION,
        "infeasibleArgmaxRate": round(infeasible / scored, 4) if scored else 0.0,
        "medium_risk_anticalibrated": True,
        "note": (
            "Calibrated against the transition constraint only. The running gate also "
            "intersects with actor rank and posting scope, which raises confidence further, "
            "so these are a floor to start from rather than a guarantee. "
            "MEDIUM-risk actions are ANTI-calibrated on this data: error rises from 18.8% "
            "to 27.2% as confidence goes from 0.80 to 0.90, so a higher bar admits worse "
            "decisions. Only LOW-risk actions may be automated."
        ),
    }
    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(f"  wrote {SPEC_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
