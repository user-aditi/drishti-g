# Research decisions — what the kill-checks decided

Wave 0 of the buildbook exists to answer, cheaply and before any building, whether
each paper has a result at all. This file records what was run, what came back,
and what was decided. Entries are append-only: a decision that later turns out to
be wrong gets a new entry underneath, not an edit.

Every number here comes from **BPI Challenge 2015** — real building-permit logs
from five Dutch municipalities, downloaded from
[4TU.ResearchData](https://data.4tu.nl/collections/BPI_Challenge_2015/5065424)
(van Dongen, 2015; CC-BY). No number here comes from seed data or from simulated
system traffic.

---

## W0.2 — does feasibility conditioning move the risk–coverage curve?

**Decided 9 September 2026. Verdict: no. The curves do not separate.**

### The question

The autonomy gate's premise is that a predictor's confidence should be
renormalised over only the actions policy permits in the current state, and that
this *automation confidence* supports safely automating more work than raw
predictive confidence does. If both confidence measures trace the same
risk–coverage curve, there is no research result in the gate — only a product
feature.

### What was run

`research/drishti_research/feasibility_check.py`, against all five municipality
logs. A counting next-activity predictor (prefix → frequency table, order 4 with
backoff, `min_support` 3), case-level temporal splits, and a feasible-action
function authored from the documented activity-code scheme in
`research/drishti_research/bpic.py` — never mined from transition frequencies.

Twenty evaluations, four regimes × five logs:

| Regime | What it tests |
|---|---|
| in-distribution | train and test on the same municipality, 70/30 by time |
| cross-municipality transfer | train on one, test on the next — the deployment case |
| data scarcity | 10% of the training history — a newly onboarded unit |
| constraint strength | `strict` (subprocess + ordinal ordering) vs `loose` (subprocess membership only) |

### What came back

**Every one of the twenty is negative.** Gating never lowered AURC by more than
0.5%, and usually raised it.

| Regime | Constraint | ΔAURC (gated − raw) | Raw argmax infeasible |
|---|---|---|---|
| in-distribution, m1–m5 | loose | +0.0009 to +0.0044 (m3: −0.0013) | 0.2% – 0.8% |
| in-distribution, m1–m5 | strict | +0.100 to +0.148 | 32% – 46% |
| transfer, m1→m2 … m5→m1 | loose | −0.0019 to +0.0036 | 0.3% – 1.1% |
| transfer, m1→m2 … m5→m1 | strict | +0.169 to +0.211 | 31% – 40% |
| scarce (10%), m1 | loose | +0.0052 | 0.9% |
| scarce (10%), m1 | strict | +0.155 | 34.5% |

Lower AURC is better, so a positive Δ means gating made the gate *worse*.

### Why — and this is the part worth writing down

The two constraint strengths fail for opposite reasons, and between them they
close off the hypothesis.

**The loose constraint is correct but not binding.** Subprocess membership is
what van Dongen's dataset description actually documents, and the real process
respects it: the true next activity fell outside the permitted set on only
1.3%–2.8% of decisions. But the counting predictor respects it too — its top
prediction was infeasible on **0.2%–1.1%** of decisions. The predictor has
already learned the constraint from the data. Masking therefore has almost
nothing to remove, and what little it removes it pays for: accuracy on the
decisions where the process genuinely deviated drops to zero by construction
(2.4%–5.0% → 0%), which is the honest cost of masking and here it is not bought
back anywhere.

**The strict constraint is binding but wrong.** Reading the three-digit group as
a position you cannot go backwards through is an inference, not something the
documentation states — and the real process violates it on 35%–52% of decisions.
Building permit handling reworks and revisits steps constantly. A rule the
institution breaks half the time is not a policy constraint; it is a bad model of
the process, and masking against it destroys accuracy (−0.05 to −0.12 at full
coverage).

Transfer and scarcity were run specifically because they are the regime where the
idea *should* pay: a predictor that has not seen enough of a process cannot have
absorbed its constraints, while authored constraints still hold. It does not pay
there either. Cross-municipality, the raw argmax is still feasible 99% of the
time.

### What was decided

1. **Paper 2, as framed in the buildbook, is dead.** "Conditioning confidence on
   the permitted set materially raises safely-automated coverage" is not a claim
   BPIC 2015 supports. Do not write it.
2. **Build the autonomy gate anyway**, as Wave 4 describes. Renormalising over
   the permitted set is still the right engineering: it is what makes an
   auto-executed action defensible to an officer, and it is what stops the
   system ever proposing something an officer is not empowered to do. It is a
   product feature and an accountability mechanism. It is not a finding.
3. **Do not report "zero constraint violations" anywhere.** Under masking that is
   zero by construction, exactly as the buildbook's review audit warned.
4. **There is a negative result here worth reporting**, and it is more useful
   than the positive one would have been: *a frequency-based next-activity model
   fitted to a municipal process already encodes that process's normative
   constraints, so explicit constraint masking adds no selective-prediction
   value — including under cross-organisation transfer and 10× data reduction.*
   That is a direct, well-evidenced caution to a line of work (Di Francescomarino
   et al. 2017 onwards) that assumes a-priori knowledge helps. It needs a
   stronger predictor before it can be claimed at full strength — see below.

### Before this negative result is published

The finding is currently established for a counting predictor only. Weytjens &
Weber (BPM 2026) is the licence for using counting as *a* baseline, not the
licence for claiming a property of all predictors. To publish the negative
result, add:

- an LSTM and a small Transformer, to show the effect is not an artefact of the
  counting model's smoothing;
- calibration (ECE, reliability diagram) for both confidence measures — an
  overlapping risk–coverage curve is compatible with very different calibration,
  and calibration is what a gate's threshold actually depends on;
- at least one log outside the BPIC 2015 family, since all five municipalities
  share a code scheme and may share the property that makes masking redundant.

---

## W0.1 — does the interpretability gap survive real data?

**Decided 9 September 2026. Verdict: yes — and it reverses. But read the second
half of this entry before celebrating.**

### The question

The interpretability study's findings all come from `generator.py`. If GRIE's
behaviour against a black box on constructed data does not reproduce on real
municipal data, the paper's contribution evaporates. This arm settles it.

### How BPIC 2015 was turned into GRIE's five signals

`research/drishti_research/bpic_signals.py`. A permit office is an org unit
processing citizen-initiated cases under a statutory clock, which is the same
shape as a complaint desk, so each signal has a structural analogue:

| GRIE signal | BPIC 2015 analogue |
|---|---|
| `slaBreachRate` | share of cases exceeding the Wabo statutory term (56 days regular, 182 extended) |
| `repeatComplaintRate` | share of cases entering the objections-and-complaints subprocess (`01_BB_*`) |
| `escalationRate` | share of cases leaving the routine track for an extended or appeal subprocess (`10_UOV_*`, `12_AP_*`) |
| `openComplaintLoad` | cases started but unfinished at the close of the period |
| `avgResolutionDays` | mean throughput time of cases finishing in the period |

**Two design decisions the paper must defend explicitly.**

*The unit is (municipality, case worker, quarter), not municipality × quarter.*
Five municipalities over twenty quarters is about a hundred rows — too thin to
separate two models on a noisy binary outcome. Using `org:resource` gives 33
workers and 268 usable unit-periods, and is the better analogue anyway: GRIE
scores the level at which work is actually held, which in NOIDA Authority is a
section, not a zone.

*The label is forward-looking, because the buildbook's instruction could not be
followed literally.* Labelling a period with "the statutory deadline was
breached" makes `slaBreachRate` — one of the five features — trivially predictive
of its own label, and both models would score near 1.0 for reasons unrelated to
interpretability. Features are therefore measured over quarter `q` and the label
is whether the unit's breach rate in quarter `q+1` lands in the worst fifth of
the panel. That is a real forecasting task, it is what GRIE is actually for, and
it is not circular. Breach rate is autocorrelated, so the current period is
legitimately informative — that is signal, and both models get it equally.

Splits are grouped by case worker, outer and inner, so no worker's quarters
straddle a split. Without that the autocorrelation leaks and everything inflates.

### What came back

268 unit-periods, 33 workers, 21.6% positive. Ten repeats of grouped 5-fold.

| Model | Test AUC | sd | Train AUC | Overfit |
|---|---|---|---|---|
| **GRIE (hand-specified)** | **0.8473** | 0.091 | 0.8654 | +0.018 |
| GRIE (tuned weights) | 0.8331 | 0.096 | 0.8713 | +0.038 |
| logistic regression | 0.8260 | 0.098 | 0.8735 | +0.048 |
| random forest | 0.8224 | 0.099 | 0.9014 | +0.079 |
| gradient boosting | 0.8102 | 0.106 | 0.9143 | +0.104 |

Paired bootstrap on the AUC gap, 2,000 resamples:

| Comparison | Gap | 95% interval | |
|---|---|---|---|
| GRIE − gradient boosting | +0.0548 | [+0.0224, +0.0892] | ahead |
| GRIE − random forest | +0.0345 | [+0.0117, +0.0596] | ahead |
| GRIE tuned − gradient boosting | +0.0422 | [+0.0106, +0.0769] | ahead |
| GRIE tuned − random forest | +0.0219 | [−0.0035, +0.0473] | no detectable difference |
| logistic − gradient boosting | +0.0273 | [−0.0040, +0.0587] | no detectable difference |
| logistic − random forest | +0.0071 | [−0.0169, +0.0318] | no detectable difference |

### Sensitivity: which of these survive the constants that were chosen, not derived

`LABEL_QUANTILE` (0.80) and `MIN_CASES_PER_PERIOD` (5) are judgement calls, so
the whole comparison was re-run across all twelve combinations of
quantile ∈ {0.70, 0.75, 0.80, 0.85} and minimum cases ∈ {3, 5, 8}
(`python -m drishti_research.bpic_study --sensitivity`, results in
`research/results/w01-bpic-sensitivity.csv`). This is the check that decides what
may actually be claimed, and **it cut two of the three headline findings down**:

| Claim | Range across 12 configurations | Survives? |
|---|---|---|
| GRIE ahead of gradient boosting | +0.0097 to +0.0695 | **yes, in all twelve** |
| GRIE ahead of random forest | −0.0130 to +0.0428 | **no — sign flips** |
| Tuning changes GRIE's AUC | −0.0191 to +0.0093 | **no — sign flips** |

Everything below is written against the sensitivity result, not against the
single headline configuration.

### Three findings, and the second is the one that matters

**1. The hand-specified interpretable model is never behind, and beats gradient
boosting consistently.** Against gradient boosting it is ahead in all twelve
configurations, and the headline configuration's bootstrap interval excludes zero
(+0.0548, [+0.0224, +0.0892]). Against the random forest the honest statement is
weaker: ahead in eleven of twelve and behind by 0.013 in the twelfth, so **"at
worst a tie with a random forest, consistently ahead of gradient boosting"** is
the claim the data supports. Rudin's argument holds here, and it holds without
any fitting at all: GRIE's weights were chosen by the team, not learned from this
panel, and they still rank next-quarter failure at least as well as a tuned
ensemble. All five signals correlate positively with the label (0.14–0.47), so
the monotone-positive assumption baked into GRIE is not merely convenient — it is
true of this data.

**2. It wins for a reason that is not flattering, and the paper must say so.**
Two diagnostics point the same way. Gradient boosting cannot beat logistic
regression (−0.016), so there is no non-additive structure for a flexible model
to find. And at n≈215 per training fold, the inner search mostly selects the
*smallest* configurations available to it — 50 iterations, 2–4 leaves, minimum
leaf 25 — and those still overfit by ~0.10 AUC. Flexibility has nothing to buy
here and something to cost. The honest claim is not "interpretable models are as
good as black boxes"; it is **"on governance panels of this size and shape, a
black box has no advantage to trade for its capacity, and cannot be regularised
into having one"**. That is a narrower claim and a defensible one.

**3. Tuning has no detectable effect on this panel.** In the headline
configuration it looked like a clear reversal of the constructed-data result —
0.8473 down to 0.8331 — but across the twelve configurations the effect ranges
from −0.019 to +0.009 and changes sign, so the reversal is not real and must not
be reported as one. The defensible statement is that **tuning neither helped nor
hurt here**, which is still informative next to the constructed study, where
tuning recovered 75–100% of a real gap in the adversarial regime. The reading
that fits both: the tuner closes gaps when there is a gap to close, and on this
panel there is none, so it has nothing to do. Report it that way, and report that
268 rows are too few to detect a small tuning effect either way.

### What was decided

1. **Paper 1 is alive and materially stronger.** The fatal "evidence is entirely
   synthetic" row in the review audit is answered: there is now a real-data arm
   on a public, citable log, and it agrees with the constructed study's
   plausible-regime finding.
2. **Rewrite the claim to the narrower one.** Not "interpretability is free" —
   "interpretability is free *where the outcome is additive in the observed
   signals and the panel is small*, which describes municipal governance data,
   and is not free where the process is genuinely non-monotone, which the
   constructed adversarial regime shows costs up to 11% of achievable skill".
3. **Name the black box in every claim.** "Consistently ahead of gradient
   boosting, at worst level with a random forest" — never the bare "beats the
   black box", which the sensitivity sweep does not support.
4. **Report tuning as no detectable effect**, not as a reversal, and say the
   panel is too small to detect a small effect either way.
5. **Publish the sensitivity table**, not just the headline configuration. It is
   the strongest methodological thing in the paper: it shows two of three
   candidate findings being discarded before anyone had to ask.
6. **State the limits plainly.** 268 unit-periods is small; the intervals are
   wide; the five signals are analogues rather than the same measurements; and
   one dataset family is one dataset family.

### Before this arm is written up

- A monthly-bucket variant, to show the conclusion is not an artefact of the
  quarterly rhythm. (Quantile and minimum-case-count sensitivity is now done.)
- The ~20 `UNVERIFIED` calibration constants still need citing or declaring —
  they affect the constructed arm only, but they affect it.


---

## Calibration constants — cited or declared

**Decided 9 September 2026. 3 verified, 17 declared, 0 unverified.**

The review audit lists "~20 unverified calibration constants" as a medium-severity
rejection risk. Every one has now been searched for.

### What was found

| Parameter | Was | Now | Source |
|---|---|---|---|
| `resolution_days_mean` | 6.2 | **12.0** | DARPG, CPGRAMS Annual Report 2024 — 24 lakh grievances, average disposal 12 days |
| `budget_overrun_mean` | 0.14 | **0.187** | MoSPI Flash Report, March 2024 — delays added ~₹5tn, 18.7% of original cost |
| `late_delivery_rate_mean` | 0.38 | **0.416** | MoSPI Flash Report, March 2024 — 779 of 1,873 projects late |

### Two things the search settled that matter more than the numbers

**The widely quoted CPGRAMS figure of 98% is a disposal rate, not a timeliness
rate.** Reading it as "only 2% breach their deadline" would have overstated
performance dramatically and put a badly wrong number in the paper. DARPG
publishes disposal counts and average disposal time but not the share closed
beyond the prescribed timeline, so `sla_breach_rate_mean` stays declared rather
than borrowing a statistic that means something else.

**MoSPI gives the right kind of number from the wrong reference class.** Its
average time overrun across delayed central projects is about 36 months —
roughly 1,080 days, plainly absurd for a municipal drain repair. That figure is
therefore *not used*; the cost-overrun and delayed-share figures are, because
they are the closest published numbers that exist, and the paper states the
mismatch rather than hiding it.

### A third status, because two were not enough

`UNVERIFIED` meant both "nobody has looked" and "there is nothing to find",
which are different problems with different remedies. A parameter somebody
searched for and could not source is not waiting on effort — it is waiting on a
disclosure in the paper. `DECLARED` says exactly that, and each one records
where the search went.

### The consequence: the constructed arm's numbers moved

Changing three constants changes the generated data and every result derived
from it. The study was re-run. **The findings hold in shape and two headline
numbers changed:**

- worst-case interpretability cost: **9.5% of achievable skill, was 11%**
- tuning recovery: **22–100%, was 75–100%**

The project entity is where tuning does least. A range beginning at 22% is a
materially weaker claim than the one previously written down, and it is the one
to report. Anyone quoting the earlier figures is quoting a run against
parameters that have since been corrected.


---

## A second panel: BPI Challenge 2018

**Started 9 September 2026. Extraction working; the study arm is not yet run.**

### Why

Every number in paper 1's real-data arm comes from BPIC 2015 — five Dutch
municipalities sharing one code scheme, one regulator and one process design. A
finding holding across five instances of the same system is one finding, not
five, and a reviewer will say so. This is the answer.

BPIC 2018 is a different country, agency, domain and generation of software: EU
direct-payment applications from German farmers, handled by federal and local
departments through *profil c/s*. **43,809 cases, 2,514,266 events, May 2014 to
January 2018.** CC0, DOI 10.4121/uuid:3301445f-95e8-4ff0-98a4-901f1f204972.

### Why it fits without forcing

It has natively what the BPIC 2015 arm had to construct:

| Needed | BPIC 2018 |
|---|---|
| org unit | `department` (4), and `org:resource` per event |
| citizen-initiated cases | farmers' payment applications |
| statutory clock | annual EU payment cycle |
| outcome | `rejected`, plus ~12 `penalty_*` flags |

### Two things the data forced, both worth writing up

**The named resources are software, not people.** "Processing automaton" alone
accounts for 165,000 events — more than any human. Picking a case's resource
arbitrarily mixes people with batch jobs and produces a panel whose largest unit
is a cron job. Humans here are opaque six-character identifiers; owners are now
the most frequent *human* toucher, and the exclusion list is explicit in
`bpic2018.py`. Before the fix the panel had 66 viable cells; after it, 189.

**`rejected` is unusable as the outcome at 0.6%.** Roughly 260 positives across
43,809 cases, which spread over unit-periods is near-zero per cell. The usable
outcome is **penalties: 35.9% of cases carry at least one**, and the process's
own judgement that something went wrong is a closer analogue to GRIE's target
than a rare terminal rejection anyway.

### The panel

Worker × quarter, mirroring the BPIC 2015 decision to use `org:resource` rather
than the coarse unit — 4 departments × 14 quarters is 24 cells, far too thin.

| Threshold | Viable cells |
|---|---|
| ≥10 cases | **189** |
| ≥20 cases | 133 |
| ≥30 cases | 96 |

Comparable to BPIC 2015's 268, and independent of it.

### Still to do

1. Derive the five GRIE signal analogues on this log — the throughput median is
   267 days against BPIC 2015's much shorter permits, so the period design needs
   checking rather than copying.
2. Run the same grouped-split comparison and sensitivity sweep.
3. Report both panels. **If they disagree, that is the finding** and it must be
   reported as one, not resolved by choosing the friendlier log.


---

## The cost of a guaranteed explanation

**Decided 10 September 2026. Verdict: there is a trade-off, it has a knee, and
the knee is measurable. This is the most novel result in the project.**

### The question nobody seems to have asked

The interpretability literature argues about model *classes*. It rarely asks the
question anyone deploying a scoring system hits immediately: **an interpretable
model can still produce a useless explanation.**

`tuning.py` records where this project met it. Unconstrained weight search
collapsed the contractor model onto a single factor at 0.998 weight — accurate,
and useless, because every explanation would have read *"this contractor is
blacklisted"* whatever else was true. The fix was a floor under every weight.
That floor must cost accuracy. Nobody had measured how much.

### Method

`explanation_cost.py`. Sweep the weight floor from 0 (free optimisation) to 0.95
of uniform weighting, and measure test AUC against **explanation concentration**
— the Herfindahl index of the weight vector, where 1.0 means one factor explains
everything and 1/k means all k contribute equally.

Floors are expressed as a *fraction of uniform* rather than an absolute value,
because entity types have different factor counts and an absolute floor is
neither comparable across them nor always feasible: 0.20 across five factors is
the entire weight budget, and the tuner rejects it.

7 floors x 2 regimes x 3 entity types x 5 seeds = 210 fits.

### What came back

The aggregate swing is 0.0073 AUC, which understates it. The finding is
per-entity, and it has a shape.

**Where free optimisation degenerates, the constraint is free — or better.**

| Contractor, adversarial | AUC | concentration | largest factor |
|---|---|---|---|
| free | 0.7902 | 0.671 | **75.2%** |
| floor at 40% of uniform | **0.7907** | 0.277 | **33.3%** |
| floor at 95% | 0.7853 | 0.251 | 27.9% |

Cutting the dominant factor from 75% to 33% — more than halving concentration —
**improves** accuracy by 0.0005. The floor is acting as regularisation.

**Where the trade-off is real, it has a knee.**

| Sector, adversarial | AUC | concentration | largest factor |
|---|---|---|---|
| free | 0.8048 | 0.541 | 71.4% |
| 40% | 0.8038 | 0.469 | 66.2% |
| 60% | 0.7984 | 0.328 | 52.0% |
| 95% | 0.7792 | 0.224 | 28.0% |

Free to 40%, then it costs — 0.026 AUC by the tightest floor.

**Where the free solution is already diffuse, the constraint does nothing.**
Project (adversarial) and every entity in the plausible regime sit flat.

### The claim

*Guaranteed explanation diversity is free up to a threshold, and the threshold
is identifiable per model.* The mechanism is clean and explains when to expect
which: where the unconstrained optimum is degenerate, the floor is a
regulariser; where it is already diffuse, there is nothing to constrain.

That is an actionable design guideline rather than a philosophical position, and
it is the kind of thing a practitioner can apply the same afternoon.

### Why this is worth building the paper around

It reframes the contribution away from "interpretable models can match black
boxes", which Rudin argued in 2019 and a 2025 systematic review has covered, and
onto a question with no established answer. The existing interpretability result
becomes a component rather than the whole claim.

Figure: `research/results/explanation-cost.png`. Data:
`research/results/explanation-cost.csv`.

### Limits to state

Constructed data only — the sweep needs the generator's two regimes, and
particularly the adversarial one, because that is where degenerate optima
appear. Whether real governance panels produce degenerate unconstrained optima
is the obvious next question, and BPIC 2015 can answer it.


---

## Cross-organisation transfer

**Decided 10 September 2026. Verdict: the advantage survives, and it widens.**

### The question

Every comparison so far trains and tests inside the same population. That is not
how a governance risk model gets deployed. An authority switching the system on
has no labelled history of its own — it has somebody else's model and the hope
that it still means something here.

That is the regime where a *hand-specified* model should have an advantage it
cannot show in-distribution. Fitted weights encode whatever was true of the
source organisation, including its accidents. Hand-chosen weights encode none of
it, because they never saw a source organisation at all.

### Design

Leave-one-municipality-out over BPIC 2015: fit on four, test on the fifth, five
times. GRIE needs no training and carries identical weights in every fold. The
inner hyperparameter search is grouped by case worker so no worker's quarters
straddle its folds.

### What came back

| Model | Mean AUC | sd | Worst fold |
|---|---|---|---|
| **GRIE (hand-specified)** | **0.8163** | 0.104 | 0.6875 |
| GRIE (tuned on source) | 0.8088 | 0.109 | 0.6982 |
| Logistic regression | 0.7875 | 0.124 | 0.6859 |
| Random forest | 0.7562 | 0.152 | 0.6068 |
| Gradient boosting | 0.7478 | 0.139 | 0.6357 |

| Comparison | Gap | Folds ahead |
|---|---|---|
| GRIE − gradient boosting | **+0.0685** | 3/5 |
| GRIE − random forest | +0.0601 | 4/5 |
| GRIE − logistic regression | +0.0288 | 3/5 |
| GRIE − GRIE tuned on source | +0.0075 | 3/5 |

### Why this is the stronger result

**The gap widens under transfer.** In-distribution, GRIE beat gradient boosting
by +0.0548. Across organisations it beats it by **+0.0685**, and the fitted
models' variance grows sharply — the random forest's standard deviation rises to
0.152 and its worst fold falls to 0.607.

That is the mechanism the argument predicted, observed: fitted models carry
source-specific structure that does not survive the move, and a model that never
fitted anything has nothing to lose. **Tuning on the source is also worse than
not tuning at all** (+0.0075), which is the same effect seen from the other side.

It also answers the obvious objection to the in-distribution result — that the
interpretable model wins because the panel is small and everything overfits.
Under transfer the training set is *larger* (four municipalities, ~190 rows) and
the fitted models still lose ground.

### One fold is degenerate, and saying so strengthens the result

Municipality 3 has **1 positive case in 75 rows** (1.3%). Every model scores
0.97–1.00 there because ranking a single positive is nearly trivial. That fold
carries no information and it should not be quietly averaged in.

Dropping it:

| Comparison | All 5 folds | Excluding municipality 3 |
|---|---|---|
| GRIE − gradient boosting | +0.0685 | **+0.0890** |
| GRIE − random forest | +0.0601 | **+0.0819** |
| GRIE − logistic regression | +0.0288 | **+0.0394** |
| GRIE − GRIE tuned on source | +0.0075 | **+0.0128** |

GRIE's mean falls to 0.7772 and gradient boosting's to 0.6882. GRIE is ahead in
**3 of the 4 informative folds**, losing only municipality 5 and losing it by
0.012–0.018 — inside the noise. The result is *better* once the uninformative
fold is removed, so the paper reports both columns and leads with the four-fold
figure.

### Limits to state plainly

Four informative folds. The intervals are wide and 3/4 is not a strong majority — the
claim is about the mean gap and the variance, not about winning every fold. The
five municipalities also share a code scheme and a regulator, so this is transfer
between *offices of the same system*, not between systems. BPIC 2018 would make
it the latter.

Figure: `research/results/transfer.png`. Data: `research/results/transfer.csv`.

### What to claim

*A hand-specified interpretable model transfers across organisations better than
models fitted on a source organisation, and the advantage is larger under
transfer than within a single population.* That is a deployment-relevant claim,
which the in-distribution comparison on its own is not.


---

## Second organisation: BPI Challenge 2018

**Run 10 September 2026. Verdict: the advantage did NOT replicate. Report it.**

### Why it was run

Every real-data number in the study came from BPIC 2015 — five Dutch
municipalities sharing a code scheme, a regulator and a process design. That is
one system observed five times, and the transfer experiment inherits the same
limit. BPIC 2018 is a different country, agency, domain and decade of software:
EU direct-payment applications from German farmers, 43,809 cases, 2.5M events.

Everything except the panel was held fixed — same fold routine, same five
models, same grouped splits, same bootstrap, same unfitted weight vector.

### Two construction decisions, both made before any model was fitted

**A system account had to be excluded, and by a rule rather than by name.**
Resource `727350` appears on 78% of all cases — 34,290 of 43,809, a hundred
times the next busiest — with 193,100 `calculate` events against 477 `insert
document`. It is a batch engine. Rather than hard-coding the ID, ownership now
excludes any resource above a 0.20 case share; the rule caught 14 system
accounts including seven the hand-written list had missed.

**Lateness cannot be the failure measure in this process.** EU direct payments
are an annual batch cycle, not a continuous stream, so cohorts move together and
the statutory deadline becomes a calendar variable: five of eight quarters have
*zero* within-quarter variance. Every duration rule tested behaves identically —
share of unit-level variance explained by quarter alone:

| candidate | rate | variance from quarter |
|---|---|---|
| missed statutory deadline | 0.283 | 0.87 |
| throughput > 365 / 425 / 500 days | 0.31 / 0.28 / 0.22 | 0.87 / 0.87 / 0.81 |
| slower than cohort p75 / p80 / p90 | 0.25 / 0.20 / 0.10 | 0.96 / 0.98 / 0.93 |
| **at least one penalty** | **0.435** | **0.24** |

Penalty incidence was the only measure varying between units *within* a period,
so `slaBreachRate` maps to it. **No AUC was computed until the measure was
fixed** — the selection is a variance decomposition of raw signals, not a search
over what made a model look good.

### The result

326 unit-quarters, 76 units, 20.2% positive.

| Model | Mean AUC | sd | Train AUC | Pooled OOF |
|---|---|---|---|---|
| GRIE (hand-specified) | 0.5622 | 0.098 | **0.5597** | 0.5596 |
| GRIE (tuned) | 0.5556 | 0.100 | 0.5881 | 0.5307 |
| Logistic regression | 0.5974 | 0.080 | 0.6595 | 0.5797 |
| Gradient boosting | 0.6161 | 0.094 | 0.8015 | 0.5889 |
| Random forest | 0.6135 | 0.074 | 0.8507 | 0.5948 |

| Gap | Point | 95% interval |
|---|---|---|
| GRIE − gradient boosting | −0.0293 | [−0.1276, +0.0694] contains 0 |
| GRIE − random forest | −0.0352 | [−0.1338, +0.0701] contains 0 |
| GRIE − logistic regression | −0.0201 | [−0.1059, +0.0627] contains 0 |
| GRIE − GRIE tuned | +0.0290 | [−0.0171, +0.0741] contains 0 |

### How this must be described

**Not "GRIE lost".** Every interval on every gap contains zero, and against a
chance baseline GRIE, GRIE-tuned and logistic regression are all
*indistinguishable from 0.5*. Gradient boosting and random forest clear it only
barely (lower bounds 0.5032 and 0.5064). The panel is close to unlearnable for
everything, and a panel that cannot rank models cannot be cited as a defeat any
more than as a win.

**The correct claim:** the interpretability advantage is demonstrated on one
process family and **did not replicate** on a second, where the forecasting task
proved close to unlearnable from these five signals. That is weaker than the
drafted claim, and it is what the evidence supports.

### The one thing that did replicate

**GRIE does not overfit and the fitted models do.** GRIE's train and test AUC
are 0.5597 and 0.5622 — identical, because nothing was fitted. Random forest
trains to 0.8507 and tests at 0.6135; gradient boosting 0.8015 to 0.6161. A gap
of 0.24 AUC between train and test is the fitted models learning 76 case workers
rather than a governance process.

**Tuning GRIE made it worse again** (+0.0290 for untuned over tuned), which is
the third independent observation of that effect after the in-distribution and
transfer arms. That much is consistent across all three panels.

### Why the panel may be a weak test rather than a fair one

Stated as a candidate explanation, not as a way to dismiss the result. The
strongest feature correlates with the label at **+0.12**, against far more in
the permit data. The analogue mapping is lossy: a payment agency's penalty flags
are not a permit office's statutory clock, and three of GRIE's five factors have
no close counterpart in an annual batch process. A reviewer is entitled to read
this either as evidence against the claim or as evidence the analogue was too
thin, and the paper should present both readings rather than pick one.

Data: `research/results/bpic2018-interpretability.csv`.


---

## Does the advantage track target persistence?

**Tested 10 September 2026. Hypothesis REFUTED, and the refutation is useful.**

### The hypothesis

BPIC 2015 has target autocorrelation +0.702 and GRIE wins; BPIC 2018 has +0.141
and nothing clears chance. Same panel sizes, same class balance, same signals.
The obvious reading is a scope condition: *the interpretability advantage grows
with how persistent the target is.* Two points do not make a relationship, so it
was tested as one — units from both panels pooled onto a single persistence axis
and bucketed, 72 units with at least four periods, 525 rows.

Absolute AUC rising with persistence would prove nothing: the label thresholds
next period's breach rate and the current rate is a feature, so persistent units
are mechanically easier. **The gap between models was the test.**

### Result

Two-way cut (36 units per bucket):

| Bucket | Pooled autocorr | Rows | 2015 share | GRIE | GBM | Gap |
|---|---|---|---|---|---|---|
| low | +0.394 | 224 | 35% | 0.6297 | 0.5971 | **+0.0325** |
| high | +0.588 | 301 | 59% | 0.7767 | 0.7482 | **+0.0286** |

Three-way cut:

| Bucket | Pooled autocorr | GRIE | GBM | Gap |
|---|---|---|---|---|
| 0 | −0.132 | 0.4733 | 0.4643 | +0.0090 |
| 1 | +0.621 | 0.7813 | 0.7812 | +0.0002 |
| 2 | +0.622 | 0.7650 | 0.7022 | +0.0628 |

**The gap is flat.** It is +0.0325 in the low bucket and +0.0286 in the high one
— if anything the wrong direction, and plainly noise either way. The hypothesis
that the interpretability advantage widens with persistence is not supported and
the paper must not claim it.

Note also that the tercile cut is not what it appears: buckets 1 and 2 have
pooled autocorrelations of +0.621 and +0.622. Ranking units by their own noisy
four-point autocorrelation produced two buckets at the same persistence level, so
a three-level reading of that table would be spurious. Both cuts are reported.

### What the test did establish, which is more useful

**Persistence governs feasibility, not the gap.** In the tercile bucket with
*negative* autocorrelation every model sits at or below chance — GRIE 0.4733,
gradient boosting 0.4643, logistic regression 0.3577. Nothing works there, for
anyone. Above that floor all models work and GRIE holds a small, consistent
lead.

So the BPIC 2018 result is explained, but by a different mechanism than the one
proposed: that panel is below the feasibility floor, not on the weak end of a
gradient. Combined with the rich-feature ceiling test — 16 features instead of 5
buys gradient boosting +0.021, from 0.616 to 0.637 — the panel is near its
information limit, and no model choice recovers it.

**GRIE's lead is more robust than the headline suggested.** It is ahead in every
bucket including the low one, which is 65% BPIC 2018 rows. The single-panel 2018
result had GRIE trailing; pooled with 2015 units at comparable persistence it
does not. That is a caution against reading either single panel too hard.

### What to claim

*Governance risk forecasting has a feasibility floor set by how persistent unit
performance is; below it no model of any class beats chance. Above it, a
hand-specified interpretable model holds a small consistent advantage that does
not vary with persistence.*

The first clause is the scope condition the study needs. The second is weaker
than the drafted claim and is what the pooled evidence supports.

Data: `research/results/persistence.csv`, `persistence-2bucket.csv`.


---

## Explanation stability: would it have been the same explanation?

**Run 10 September 2026. New result, and it inverts the usual framing.**

### The unasked question

`explanation_cost.py` asks whether an explanation is *concentrated*. This asks
the other thing that decides whether an explanation is worth anything, and which
the literature almost never measures: **is it stable?**

A model is called interpretable if a human can read its parameters. That is a
claim about form, not behaviour. A weighted sum whose largest factor is
`slaBreachRate` on one sample and `repeatComplaintRate` on another is perfectly
readable and useless as an explanation — the sentence shown to an officer would
change because the training sample changed, not because anything about the
sector changed.

### Design

Forty bootstrap resamples of the training **units** (not rows — resampling rows
would split a unit's quarters across train and test and leak). Refit, then
record each model's permutation-importance vector over the five signals. Across
every pair of resamples: Spearman agreement of the vectors, how often the same
factor leads, and how often attributions flip sign.

Permutation importance is written out locally rather than taken from sklearn,
because `InterpretableScorer` has no `fit`. One instrument for all five models
matters — coefficients cover only the linear ones, impurity importance only the
trees, and a per-model instrument would measure the instruments.

Three of forty resamples were dropped: a bootstrap draw can leave the inner
grouped CV with a single-class fold, every candidate scores nan, and
`GridSearchCV` still returns a model having picked parameters arbitrarily.
Counting an arbitrary model's attributions as a fitted model's disagreement
would inflate exactly the quantity being measured.

### Result

| Model | Rank agreement | **Top-1 agreement** | Sign flips | AUC |
|---|---|---|---|---|
| GRIE (fixed weights) | 1.000 | 1.000 | 0.000 | 0.847 |
| GRIE (tuned) | 0.728 | **0.480** | 0.193 | 0.845 |
| Random forest | 0.702 | 0.754 | 0.240 | 0.811 |
| Logistic regression | 0.640 | 0.847 | 0.178 | 0.830 |
| Gradient boosting | 0.560 | **0.847** | 0.420 | 0.800 |

Which factor leads the explanation, across resamples:

| Model | Leading factor distribution |
|---|---|
| GRIE (tuned) | slaBreachRate 62%, repeatComplaintRate 32%, openComplaintLoad 5% |
| Logistic regression | slaBreachRate 92%, repeatComplaintRate 8% |
| Random forest | slaBreachRate 86%, repeatComplaintRate 11%, openComplaintLoad 3% |
| Gradient boosting | slaBreachRate 92%, repeatComplaintRate 8% |

### The finding

**The most transparent fitted model has the least stable explanation.** Tuned
GRIE — a five-term weighted sum, as readable as a model gets — names a different
leading factor in **52%** of resample pairs. Gradient boosting, the least
readable model in the comparison, names the same one **85%** of the time.

The mechanism is visible in the distribution: tuning leaves GRIE's weights
nearly tied between `slaBreachRate` and `repeatComplaintRate`, so a small change
in the sample flips the ordering. The black boxes lock onto `slaBreachRate` and
stay there.

So **interpretability of form does not deliver interpretability in practice.**
Transparency of structure and stability of explanation are separate properties,
they are not correlated here, and the literature's habit of arguing about model
classes measures only the first.

**What buys stability is fixing the weights, not the model being a weighted
sum.** GRIE-as-shipped scores 1.000 by construction and is drawn as a reference
line rather than entered as a competitor — claiming a win for a model whose
weights cannot move would be circular. The comparison that carries the result is
tuned GRIE against the black boxes, both fitted, and the transparent one loses.

One nuance worth reporting: gradient boosting has the **highest sign-flip rate**
(0.420) despite the best top-1 agreement. It agrees on which factor leads while
the minor factors reverse direction constantly — stable headline, unstable
detail.

### Why this matters to the paper

It converts the shipped design decision from a limitation into a result. Fixed
hand-chosen weights were previously defensible only as "we could not fit them
well". They are now defensible as the *only* configuration tested that produces
an explanation which does not move — at a cost of 0.002 AUC against tuned GRIE
(0.847 vs 0.845).

Paired with the explanation-cost curve, this gives two measured properties of
explanation quality — concentration and stability — neither of which is captured
by the model-class debate.

Figure: `research/results/explanation-stability.png`.
Data: `research/results/explanation-stability.csv`.
