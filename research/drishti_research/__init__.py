"""Research harness for the DRISHTI-G interpretability paper.

The question, from Section 10 of the project plan:

    Does keeping a governance risk score interpretable cost much accuracy
    against a black-box model, and does fine-tuning close most of that gap?

GRIE is the treatment, gradient boosting is the control, and the dataset is
constructed — because no public dataset links budget, delay, inspection and
complaint history to an outcome label. See generator.py for how the label is
produced and why the comparison is fair.

The constructed dataset is no longer the only evidence. The `bpic_*` modules
add a real-data arm on BPI Challenge 2015, and `feasibility_check` is the
autonomy-gate kill-check that shares its loader. What each arm is allowed to
prove, and what the kill-checks decided, is in `docs/research-decisions.md`.
"""

__all__ = [
    "bpic",
    "bpic_signals",
    "bpic_study",
    "calibration",
    "experiments",
    "feasibility_check",
    "generator",
    "model_spec",
    "models",
    "tuning",
]
