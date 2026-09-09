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

| Regime | Entity | Best black box | GRIE | GRIE tuned | Gap | Recovered by tuning |
|---|---|---|---|---|---|---|
| plausible | Sector | 0.959 | 0.948 | 0.971 | 0.011 | fully |
| plausible | Project | 0.941 | 0.967 | 0.981 | ahead | — |
| plausible | Contractor | 0.925 | 0.932 | 0.968 | ahead | — |
| adversarial | Sector | 0.979 | 0.884 | 0.936 | **0.095** | 55% |
| adversarial | Project | 0.980 | 0.934 | 0.944 | 0.046 | 22% |
| adversarial | Contractor | 0.970 | 0.897 | 0.988 | 0.074 | fully |

> **These numbers changed on 9 September 2026** and the earlier ones should not
> be quoted. Three calibration constants moved from assumed values to published
> figures — `resolution_days_mean` 6.2 → 12.0 days (CPGRAMS 2024),
> `budget_overrun_mean` 0.14 → 0.187 and `late_delivery_rate_mean` 0.38 → 0.416
> (MoSPI, March 2024) — which changes the generated data and therefore every
> result derived from it.
>
> The findings hold in shape. Two numbers the paper would have quoted did move:
> the worst-case interpretability cost is **9.5% of achievable skill, not 11%**,
> and tuning recovers **22–100%, not 75–100%**. The project entity is where
> tuning does least, and a range starting at 22% is a weaker claim than the one
> previously written down. Report the weaker one.

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

---

## The real-data arm — BPI Challenge 2015

The constructed dataset above is no longer the only evidence. `bpic_signals.py`
derives GRIE's five signals from **BPI Challenge 2015**: real building-permit
logs from five Dutch municipalities, from
[4TU.ResearchData](https://data.4tu.nl/collections/BPI_Challenge_2015/5065424)
(van Dongen 2015, CC-BY). Download the five `.xes` files into
`data/bpic2015/`; they are gitignored, and the first run caches a flat event
table beside them.

```bash
python -m drishti_research.bpic_study                # the comparison
python -m drishti_research.bpic_study --sensitivity  # the constants sweep — run this too
```

**Read `docs/research-decisions.md` before quoting any number from this arm.**
The short version: on 268 unit-periods, hand-specified GRIE is ahead of gradient
boosting in all twelve sensitivity configurations and at worst level with a
random forest — but the diagnostics say it wins because the signal is additive
(boosting cannot beat logistic regression) and because at this sample size even
the smallest boosted configuration overfits by ~0.10 AUC. The claim the data
supports is narrow: *a black box has no advantage to trade for its capacity on
governance panels of this size and shape*.

The sensitivity sweep discarded two of the three findings the headline run
suggested. Publish the sweep, not just the headline.

---

## The gate kill-check

`feasibility_check.py` and `bpic.py` belong to the second paper, not this one.
They answered W0.2 — whether renormalising a next-action predictor's confidence
over the policy-permitted set moves the risk–coverage curve — and the answer was
no, across twenty evaluations. `docs/research-decisions.md` has the working.
`bpic.py` is shared: its loader and code-scheme parser feed both arms.

---

## Layout

```
drishti_research/
  calibration.py       every marginal, with a source field and a verification status
  model_spec.py        loads GRIE's exported weights and curves
  generator.py         the constructed dataset and its two regimes
  models.py            InterpretableScorer, gradient boosting, random forest, logistic
  tuning.py            constrained weight optimisation
  diagnostics.py       fairness checks — run these first
  experiments.py       the protocol, the tables

  bpic.py              BPIC 2015 loading, the code scheme, the feasible-action function
  bpic_signals.py      GRIE's five signals derived from BPIC 2015, with a forward label
  bpic_study.py        the interpretability comparison on real data, plus --sensitivity
  feasibility_check.py W0.2, the autonomy-gate kill-check

  classifier.py        W3.1 — TF-IDF + naive Bayes over complaint text
  predictor.py         W3.2 — next-activity counting model with backoff
  sla.py               W3.3 — observed resolution quantiles per bucket
data/
  model-spec.json  exported from the backend; do not hand-edit
  bpic2015/        downloaded logs and their cache — gitignored, not vendored
  complaints.csv     event-log.csv     |  exported from the running system; regenerate, never edit
  resolutions.csv   |
  sim-labels.csv   /
results/           CSV output
```

---

## The three in-system models

These are a different exercise from the interpretability study above. That study
asks a research question; these three exist to make the product work, and each
is trained here, exported as JSON, and executed in TypeScript so the model that
ships is the model that was measured.

```bash
cd backend && npm run sim:run -- --reset --days 75 --per-day 28   # generate traffic
cd backend && npm run export:training                             # complaints + labels
cd backend && npm run export:eventlog                             # the process log
cd backend && npm run export:resolutions                          # how long things took
```

```bash
cd research
python -m drishti_research.classifier
python -m drishti_research.predictor
python -m drishti_research.sla
```

**Two of the three shipped. One did not, and the difference is the finding.**

| | Result | Shipped |
|---|---|---|
| `classifier.py` | 10.8% against the keyword matcher's 82.4% | **No** — `CLASSIFIER_ENABLED = false` |
| `predictor.py` | 0.815, versus gradient boosting's 0.815 | Yes |
| `sla.py` | learned p50/p90 per bucket, with backoff | Yes |

The classifier fails because the corpus cannot support it: 1,094 complaints
share **23 distinct texts**. Split by row it reports 100% — memorisation wearing
a rosette — and split by distinct phrasing it collapses. No tuning fixes that;
only a corpus with real variety would.

The predictor succeeds because the lifecycle is genuinely uncertain even though
its state machine is small, and because its confidence is *monotone*: held-out
accuracy runs 0.976 / 0.924 / 0.664 / 0.515 down the confidence bands. That
table is the evidence that Wave 4's autonomy gate can exist at all — a flat one
would have meant the gate was theatre.

**Do not quote any of these numbers as evidence about municipal work.** They are
measured on generated traffic, and the classifier's labels are the generator's
own. See `docs/pending-work.md` §6.

## Still to do before the paper

1. Replace the `UNVERIFIED` calibration parameters with cited figures.
2. Add bootstrap confidence intervals on the skill gap — five seeds show the spread but do not give an interval.
3. Report a cost-sensitive operating point. AUC treats a missed severe failure and a false alarm as equally important; a supervisor's queue does not.
4. Sensitivity analysis on `MIN_WEIGHT` — how much accuracy does each increment of guaranteed explainability cost?
