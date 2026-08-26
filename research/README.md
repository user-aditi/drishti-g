# DRISHTI-G — research harness

The experiment behind the paper. From Section 10 of the project plan:

> **Does keeping a governance risk score interpretable cost much accuracy against a black-box model, and does a fine-tuning step close most of that gap?**

GRIE is the **treatment**. Gradient boosting and random forest are the **controls**. The dataset is **constructed**, and the paper must say so.

---

## Running it

```bash
cd backend && npm run export:model
```

```bash
cd research && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
```

```bash
cd research && .venv/Scripts/python -m drishti_research.diagnostics
```

```bash
cd research && .venv/Scripts/python -m drishti_research.experiments
```

**Run the diagnostics first, and read them alongside the results.** The gap numbers are close to meaningless without the ceiling and overfit checks beside them — see *Two mistakes we made* below.

Results land in `results/` as CSV.

---

## The interpretable model is not re-implemented here

`backend/scripts/export-model-spec.ts` writes GRIE's weights and normalisation curves to `data/model-spec.json` straight out of the code that scores complaints in production. `model_spec.py` reads that file.

That indirection is the point. A Python re-implementation could drift from the shipped model by one weight or one cap, and nothing would catch it — quietly invalidating every number in the results table. Re-export whenever the model changes.

---

## What the dataset is, and what it is not

No public dataset links a project's budget, its delays, its inspection failures and its complaint history to an outcome label. So `generator.py` builds one.

Entities are drawn from a **latent governance-quality variable neither model sees**. Observable signals are noisy functions of it; the outcome — did this area or contract suffer a serious governance failure — is drawn from it too. So there is a real ground truth, and both models must recover it from noisy proxies.

**Two regimes, both reported.** One number from one data-generating process would be a claim the experiment cannot support.

| Regime | What it represents |
|---|---|
| `plausible` | What the team believes governance data looks like: correlated positive signals, mild interactions, a large irreducible noise component. |
| `adversarial` | Structure a weighted sum **cannot** represent, including a non-monotone effect: in a coping area escalations are healthy, but in an area already drowning a *low* escalation rate is the danger sign — complaints are being closed without being worked. No monotone weighted sum can express "high is bad here, low is bad there". |

`calibration.py` holds every marginal the generator is anchored to, each with a `source` field. **Twenty parameters are currently marked `UNVERIFIED`** — plausible defaults, not figures anyone looked up. They are fine for a model comparison, because the research question is about the *relationship* between two models on the same data. They are **not** fine as evidence about real Indian governance rates. Replace them with cited figures before the paper is written; the runner prints a warning until you do.

---

## Two mistakes we made, and what they should teach the paper

Both were caught by `diagnostics.py`, which exists precisely to stop them reaching a results table.

**1. The first run said the interpretable model beat gradient boosting.** It did — because the black box was overfitting by **0.14 AUC** on a few thousand rows with five features. Beating a model that has memorised its training split proves nothing. Capacity is now deliberately modest (8 leaves, depth 4, 40-sample leaves, aggressive early stopping) and the overfit gap is checked every run.

**2. The "no structure" diagnostic was backwards.** It compared the boosted model against itself with oracle interaction terms added, and read the near-zero difference as "the data is additive". Trees *construct* those interactions from raw columns, so handing them over changes nothing — the null result meant the black box had already found the structure. The check now compares boosting against a fitted **linear** model, which is the real question.

The second mistake surfaced the finding that actually matters: **this task is noise-limited, not capacity-limited.** The best model sits within ~0.01 AUC of the Bayes ceiling. Models converge because the outcome is mostly irreducible, not because interpretability is free.

That is why results are reported as **skill** rather than raw AUC:

```
skill = (AUC − 0.5) / (Bayes ceiling − 0.5)
```

1.0 is the best any model could do; 0.0 is a coin flip. A 0.005 raw AUC difference looks negligible and is not, when the whole achievable band is 0.3 wide.

---

## What we found

Skill, mean over five seeds, held-out test split.

| Regime | Entity | Black box | GRIE | GRIE tuned | Gap | After tuning |
|---|---|---|---|---|---|---|
| plausible | Sector | 0.958 | 0.956 | 0.971 | 0.002 | ahead |
| plausible | Project | 0.939 | 0.967 | 0.979 | ahead | ahead |
| plausible | Contractor | 0.951 | 0.971 | 0.989 | ahead | ahead |
| adversarial | Sector | 0.982 | 0.871 | 0.954 | 0.110 | **75% closed** |
| adversarial | Project | 0.970 | 0.943 | 0.948 | 0.027 | 18% closed |
| adversarial | Contractor | 0.970 | 0.893 | 0.978 | 0.077 | **100% closed** |

Read carefully, that is two findings:

- **On plausibly-shaped governance data, interpretability costs nothing.** GRIE matches or beats a tuned ensemble. This is Rudin's argument holding in a governance setting.
- **When the underlying process is genuinely non-monotone, it costs real accuracy** — up to 11% of achievable skill — **and weight tuning recovers most of it.**

Neither finding survives without the other. Reporting only the first would be the cherry-picked version of this paper.

---

## The constraint that keeps tuning honest

Unconstrained tuning collapsed the contractor model to a single factor at **0.998 weight**. Accurate, and useless: every explanation would have read *"this contractor is blacklisted"* whatever else was true, and the reviewing officer would have learned nothing about the work.

`tuning.py` therefore enforces a floor (`MIN_WEIGHT = 0.05`) so every factor stays materially present. Tuned weights remain non-negative and sum to 1.0, so the result is still a weighted sum of the same explainable factors on the same 0-100 scale.

**This costs accuracy, and the paper should report the cost rather than quietly taking the degenerate optimum.** It is the clearest concrete instance of the trade the paper is about.

---

## Layout

```
drishti_research/
  calibration.py   every marginal, with a source field and a verification status
  model_spec.py    loads GRIE's exported weights and curves
  generator.py     the constructed dataset and its two regimes
  models.py        InterpretableScorer, gradient boosting, random forest, logistic
  tuning.py        constrained weight optimisation
  diagnostics.py   fairness checks — run these first
  experiments.py   the protocol, the tables
data/
  model-spec.json  exported from the backend; do not hand-edit
results/           CSV output
```

## Still to do before the paper

1. Replace the `UNVERIFIED` calibration parameters with cited figures.
2. Add bootstrap confidence intervals on the skill gap — five seeds show the spread but do not give an interval.
3. Report a cost-sensitive operating point. AUC treats a missed severe failure and a false alarm as equally important; a supervisor's queue does not.
4. Sensitivity analysis on `MIN_WEIGHT` — how much accuracy does each increment of guaranteed explainability cost?
