"""Research harness for the DRISHTI-G interpretability paper.

The question, from Section 10 of the project plan:

    Does keeping a governance risk score interpretable cost much accuracy
    against a black-box model, and does fine-tuning close most of that gap?

GRIE is the treatment, gradient boosting is the control, and the dataset is
constructed — because no public dataset links budget, delay, inspection and
complaint history to an outcome label. See generator.py for how the label is
produced and why the comparison is fair.
"""

__all__ = [
    "calibration",
    "experiments",
    "generator",
    "model_spec",
    "models",
    "tuning",
]
