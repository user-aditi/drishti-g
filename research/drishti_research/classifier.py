"""Train the complaint classifier, and export it for TypeScript to run.

    python -m drishti_research.classifier

The same arrangement GRIE already uses, in the other direction. GRIE is written
in TypeScript and exported to Python so the study measures the model that
actually ships. This is written in Python and exported to TypeScript so the
model that ships is the one that was measured. Either way the rule is that
nothing is re-implemented twice, because two implementations drift by one
coefficient and nothing catches it.

What the labels are, and why it matters more than the model
----------------------------------------------------------
Three label columns arrive in ``complaints.csv`` and they are not
interchangeable:

``gcce_category``
    What the keyword matcher decided. Thousands of rows, and **circular**:
    training on it teaches the classifier to imitate the thing it replaces, and
    "beats the keyword baseline" becomes a measure of how well it copied.

``confirmed_category``
    What a citizen said when shown the classification. The only label that
    would exist on a real deployment, and the only one that is genuine
    supervision. There are a few hundred here and there would be far fewer on a
    young deployment.

``true_category``
    Which template generated the complaint. Real ground truth *for this
    dataset*, uncontaminated by the matcher — and it exists only because the
    dataset was generated.

Training uses ``true_category``. That makes every accuracy figure below a
**demonstration that the pipeline works**, not evidence about municipal text: a
model trained on a generator's labels has learned the generator. The number
worth reading is not the accuracy but the *gap* between the classifier and the
keyword baseline on the cases the matcher gets wrong — because the simulator's
phrasings deliberately include complaints carrying no keyword at all, and a few
carrying the wrong category's keyword.

On real data the label must be ``confirmed_category`` and the training set will
be small and slow to grow. That is the honest constraint, and it is why the
product had to be able to record agreement at all before this was worth
building.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research" / "data" / "complaints.csv"
SPEC_OUT = ROOT / "backend" / "data" / "classifier-spec.json"

MODEL_VERSION = "clf-v1-tfidf-nb"

#: What the TypeScript side must be able to execute. Bump this and the constant
#: in classifier.ts together whenever the tokeniser, the weighting or the shape
#: of the exported table changes — an old spec then refuses to load rather than
#: being run by code that no longer reproduces it.
CONTRACT = "clf/tfidf-l2/multinomial-nb/1"

#: Below this, GCCE keeps the keyword matcher's answer instead. Chosen from the
#: reliability curve printed at the bottom of this run, not picked in advance.
DEFAULT_FLOOR = 0.35

#: The tokeniser. Deliberately trivial and written out in full, because the
#: TypeScript side must reproduce it exactly — every clever preprocessing step
#: is one more thing to reimplement identically or silently disagree about.
TOKEN = re.compile(r"[a-z0-9]+")


def tokenise(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


@dataclass
class Report:
    name: str
    accuracy: float
    n: int


def load() -> pd.DataFrame:
    if not DATA.exists():
        raise SystemExit(
            f"No training data at {DATA}.\n"
            "Run, in order:\n"
            "  cd backend && npm run dev:sim         (in one terminal)\n"
            "  cd backend && npm run sim:run -- --reset --days 45 --per-day 25\n"
            "  cd backend && npm run export:training"
        )

    frame = pd.read_csv(DATA)
    frame["text"] = (frame["title"].fillna("") + " " + frame["description"].fillna("")).str.strip()
    return frame


def keyword_baseline(frame: pd.DataFrame) -> Report:
    """How well GCCE's keyword matcher recovers the truth, on the same rows.

    This is the number the classifier has to beat, and it is measured on the
    *same* held-out split rather than over everything, so the comparison is
    like for like.
    """
    labelled = frame.dropna(subset=["true_category", "gcce_category"])
    return Report(
        name="keyword matcher",
        accuracy=accuracy_score(labelled["true_category"], labelled["gcce_category"]),
        n=len(labelled),
    )


def main() -> None:
    frame = load()

    labelled = frame.dropna(subset=["true_category"])
    labelled = labelled[labelled["text"].str.len() > 0]

    if len(labelled) < 100:
        raise SystemExit(
            f"Only {len(labelled)} labelled complaints. Generate more traffic before training —\n"
            "ten classes need a few hundred rows before a split means anything."
        )

    print(f"--- complaint classifier --- {len(labelled)} labelled complaints")
    print(f"    classes: {labelled['true_category'].nunique()}")
    print()

    # Split by DISTINCT TEXT, not by row.
    #
    # The first version split by row and reported 100% accuracy, which was
    # memorisation wearing a rosette. The simulator draws from about two dozen
    # hand-written phrasings, so each distinct complaint text appears around
    # fifty times: a random row split puts verbatim copies of every test example
    # into the training set, and the model only has to recognise which of
    # twenty-three strings it is looking at.
    #
    # Grouping by text is the only split that asks the question the classifier
    # will actually face — can it categorise a phrasing it has never seen. On
    # this corpus that is close to impossible and the accuracy below says so.
    # That is the honest number, and the finding is about the *corpus*, not the
    # model: a few dozen templates cannot train or evaluate a text classifier.
    texts = labelled["text"].drop_duplicates()
    train_texts, test_texts = train_test_split(texts, test_size=0.3, random_state=20260909)
    train = labelled[labelled["text"].isin(train_texts)]
    test = labelled[labelled["text"].isin(test_texts)]

    print(f"    distinct phrasings: {len(texts)}  ({len(train_texts)} train / {len(test_texts)} test)")
    if len(texts) < 200:
        print()
        print("    WARNING — this corpus is far too uniform to evaluate a classifier on.")
        print(f"    {len(labelled)} complaints share {len(texts)} distinct texts, about")
        print(f"    {len(labelled) / len(texts):.0f} copies each. Everything below measures how")
        print("    well the model generalises across a couple of dozen templates, which is")
        print("    not the same question as classifying municipal complaint text.")
    print()

    vectoriser = TfidfVectorizer(
        tokenizer=tokenise,
        lowercase=True,
        token_pattern=None,
        min_df=2,
        sublinear_tf=False,
        norm="l2",
    )
    x_train = vectoriser.fit_transform(train["text"])
    x_test = vectoriser.transform(test["text"])

    model = MultinomialNB(alpha=0.1)
    model.fit(x_train, train["true_category"])

    predictions = model.predict(x_test)
    accuracy = accuracy_score(test["true_category"], predictions)

    # The baseline, on the identical held-out rows.
    baseline_rows = test.dropna(subset=["gcce_category"])
    baseline_accuracy = accuracy_score(
        baseline_rows["true_category"], baseline_rows["gcce_category"]
    )

    print(f"  classifier      {accuracy:.3f}  on {len(test)} held-out complaints")
    print(f"  keyword matcher {baseline_accuracy:.3f}  on {len(baseline_rows)} of the same rows")
    print(f"  difference      {accuracy - baseline_accuracy:+.3f}")
    print()

    # The interesting subset: rows the matcher got wrong. Overall accuracy is
    # dominated by the easy cases both get right, and hides whether the model
    # actually recovers anything the matcher missed.
    missed = baseline_rows[baseline_rows["true_category"] != baseline_rows["gcce_category"]]
    if len(missed) > 0:
        recovered = accuracy_score(
            missed["true_category"], model.predict(vectoriser.transform(missed["text"]))
        )
        print(f"  on the {len(missed)} the matcher got wrong, the classifier recovers {recovered:.1%}")
    else:
        print("  the matcher got every held-out row right — no recovery to measure")
    print()

    print(classification_report(test["true_category"], predictions, zero_division=0))

    # --- reliability -------------------------------------------------------
    #
    # Whether the confidence means anything. The fallback floor is chosen from
    # this rather than assumed: if accuracy in the lowest band is no worse than
    # the rest, the confidence carries no information and thresholding on it is
    # theatre.
    probabilities = model.predict_proba(x_test)
    top = probabilities.max(axis=1)
    correct = predictions == test["true_category"].to_numpy()

    print("  confidence   n     accuracy")
    for low, high in [(0.0, 0.35), (0.35, 0.6), (0.6, 0.85), (0.85, 1.01)]:
        band = (top >= low) & (top < high)
        if band.sum() == 0:
            continue
        print(f"  {low:.2f}-{high:<5.2f} {band.sum():<5d} {correct[band].mean():.3f}")
    print()

    export(vectoriser, model, accuracy, baseline_accuracy, len(train))


def export(
    vectoriser: TfidfVectorizer,
    model: MultinomialNB,
    accuracy: float,
    baseline: float,
    trained_on: int,
) -> None:
    """Write the whole model as JSON, so TypeScript can execute it.

    Everything needed to reproduce a prediction and nothing else: the
    vocabulary, the idf weights, the class priors and the per-feature log
    probabilities. No pickle, because a pickle is unreadable, unversionable and
    only loadable by the library that wrote it.
    """
    vocabulary = {term: int(index) for term, index in vectoriser.vocabulary_.items()}

    spec = {
        "contract": CONTRACT,
        "modelVersion": MODEL_VERSION,
        "trainedAt": pd.Timestamp.utcnow().isoformat(),
        "trainedOn": trained_on,
        "confidenceFloor": DEFAULT_FLOOR,
        "labelSource": "simulator ground truth — see the module docstring before quoting accuracy",
        "accuracy": round(float(accuracy), 4),
        "keywordBaselineAccuracy": round(float(baseline), 4),
        "classes": [str(c) for c in model.classes_],
        "vocabulary": vocabulary,
        "idf": [float(v) for v in vectoriser.idf_],
        "classLogPrior": [float(v) for v in model.class_log_prior_],
        # One row per class, one column per vocabulary term.
        "featureLogProb": [[float(v) for v in row] for row in model.feature_log_prob_],
    }

    SPEC_OUT.parent.mkdir(parents=True, exist_ok=True)
    SPEC_OUT.write_text(json.dumps(spec), encoding="utf-8")

    size_kb = SPEC_OUT.stat().st_size / 1024
    print(f"  wrote {SPEC_OUT.relative_to(ROOT)} ({size_kb:.0f} KB)")
    print(f"  {len(vocabulary)} terms x {len(spec['classes'])} classes")

    # --- the fixture the TypeScript side is checked against ----------------
    #
    # A handful of examples with the exact scores this model produced. If the
    # TypeScript scorer disagrees with any of them, the two implementations have
    # drifted and the shipped model is not the studied one.
    write_fixture(vectoriser, model)


def write_fixture(vectoriser: TfidfVectorizer, model: MultinomialNB) -> None:
    frame = load()
    sample = frame.dropna(subset=["true_category"]).head(12)

    cases = []
    for _, row in sample.iterrows():
        vector = vectoriser.transform([row["text"]])
        log_probs = model._joint_log_likelihood(vector)[0]  # noqa: SLF001
        best = int(np.argmax(log_probs))
        # Normalise in log space, the way the TypeScript side must.
        shifted = log_probs - log_probs.max()
        confidence = float(np.exp(shifted[best]) / np.exp(shifted).sum())

        cases.append(
            {
                "text": row["text"],
                "expectedCategory": str(model.classes_[best]),
                "expectedConfidence": round(confidence, 6),
            }
        )

    out = ROOT / "backend" / "tests" / "fixtures" / "classifier-cases.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cases, indent=2), encoding="utf-8")
    print(f"  wrote {out.relative_to(ROOT)} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
