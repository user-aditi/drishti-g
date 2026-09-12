# Where DRISHTI-G needs more than a full stack

> **Written before the NYC 311 rebuild.** Several gaps listed here have since
> been closed on `rebuild/nyc-311`, and closed differently from what is proposed
> below: risk scoring is fitted and calibrated against real outcomes (Phase 7),
> routing was measured and found to have nothing to learn from NYC's intake
> (F-23), and photo verification ships checking what a photograph can actually
> establish rather than what it shows (Phase 8). Read
> [research-decisions.md](research-decisions.md) for what was measured, and
> treat this file as the reasoning that led there.

A working list of the places this system is currently held up by a deliberate
approximation, and what would actually be needed to close the gap. Written to be
picked up **after** the site structure is finished, so nothing here should be
started while screens are still missing.

The data these models need, the technology that has to sit around them, and
what should be deleted before any of it is built, are in
[real-world-readiness.md](real-world-readiness.md).

Each entry says three things: what the code does today, why that is not enough,
and what would replace it. The "today" column matters — every one of these is
already running as an honest baseline, not a stub, so the ML work is a
*replacement with something measurably better*, never a rescue.

That framing is also the paper's. The research question this project is built
around is **interpretability versus accuracy in governance risk scoring**, and
almost every item below is a chance to measure exactly that: a transparent rule
that a municipal officer can audit by eye, against a learned model that scores
better and explains worse.

---

## 1. Confirming that work was actually done — computer vision

**Today.** `backend/src/services/verification.ts` runs five checks over a
worker's uploaded proof: something was submitted, it is not a file already used
on another job, its EXIF timestamp postdates the work order, its EXIF GPS falls
near the sector centroid, and it arrived before the deadline.

**Why that is not enough.** Not one of those checks looks at the *picture*. They
establish that a photograph is fresh, unique and taken in roughly the right
place — they cannot establish that the pothole in it is filled. A worker who
photographs a different, intact stretch of road fifty metres away passes every
check we have. The system currently compensates by asking the citizen, which
works but spends the one resource the design cannot manufacture: a resident's
willingness to answer.

**What would replace it.**

| Capability | Approach | Notes |
|---|---|---|
| Before/after comparison | Siamese / embedding distance between the citizen's complaint photo and the worker's proof | The strongest available signal, and it needs no labels: the pair is already in the database |
| Defect detection | Fine-tuned object detector (YOLO-class) over pothole / garbage-pile / broken-streetlight classes | Needs a labelled set; Indian road-defect datasets exist and can be extended with our own uploads |
| Same-place verification | Local feature matching (SIFT/LoFTR) between the two photos | Answers "is this the same spot?", which is the fraud EXIF cannot catch |
| Re-encode-resistant duplicates | Perceptual hashing (dHash/pHash) replacing the current SHA-256 | Today a worker who re-saves a recycled photo at 90% quality defeats the content hash |

**Where it plugs in.** `assessSubmission()` already returns a weighted, itemised
list of `Check` objects. A vision model becomes one more check with its own
weight and its own sentence of explanation — no other code has to change, and
the score stays as auditable as it is now.

**The measurement worth publishing.** Human-verified outcomes are already being
collected on every job (`Verification.outcome`, `Complaint.citizenConfirmed`).
That is a labelled evaluation set accumulating for free. Report precision and
recall of the CV checks against citizen verdicts, and the reduction in officer
interventions — the second number is the one an authority would actually buy.

---

## 2. Reading what a citizen wrote — NLP

**Today.** GCCE classifies a complaint by matching comma-separated keywords on
each `ComplaintCategory`, including deliberately Hinglish ones (`gaddha`,
`kachra`, `batti`). Clustering of similar grievances uses token overlap with a
Hinglish stopword list.

**Why that is not enough.** Keyword matching cannot handle negation, cannot
handle a description that never names the thing, and degrades badly on
code-mixed text — "gali ki light se spark ho raha hai" should route to
Electrical on the strength of *spark*, but "andhera rehta hai" should too and
carries no keyword at all. Every miss lands a complaint in the wrong
department's queue, where it sits until somebody notices.

**What would replace it.**

- **Category routing:** fine-tuned multilingual encoder (MuRIL or IndicBERT —
  both trained on transliterated Hindi, which is what citizens actually write)
  as a classifier over the existing category set.
- **Similarity and clustering:** sentence embeddings instead of token overlap,
  so "nali jam hai" and "drain blocked, sewage on the road" land in one cluster
  without sharing a single token.
- **Severity extraction:** span tagging for the phrases that signal danger —
  *spark, current, bacha, gir gaya, accident* — feeding the priority score.

**Where it plugs in.** `routeComplaint()` in `services/gcce.ts` already returns
a `reasons[]` trace. A model must return the same trace, or the routing stops
being explainable to the officer who receives the complaint. Keep the keyword
classifier as the fallback when model confidence is low, and record which one
decided — that field is the dataset for the paper's comparison.

---

## 3. Scoring risk and priority — the paper's actual question

**Today.** GRIE scores entities with a transparent weighted sum whose factors
each carry a `contribution` that adds up to the total. Complaint priority
(`services/priority.ts`) works the same way.

**Why this is the interesting one.** Unlike the items above, the baseline here
is not obviously worse. A weighted sum an Executive Engineer can check by hand
has real institutional value: it can be argued with, appealed, and defended in a
hearing. A gradient-boosted model will score better on held-out data and cannot
do any of those things.

**What to build, and what to measure.**

- Gradient boosting (XGBoost/LightGBM) over the same signals, with SHAP values
  standing in for the per-factor contributions.
- A monotonic-constraint variant — forcing "more overdue complaints must never
  lower risk" — which recovers much of the argue-with-it property.
- Report the accuracy gap **and** an interpretability measure: officer agreement
  with the explanation, or simulatability (can a person predict the model's
  output from its explanation?).

**The honest hypothesis.** The gap will be small on this data, because the
signals are few and largely monotonic. If so, that is the finding: for
governance scoring at municipal scale, the transparent model costs almost
nothing and buys a great deal. A negative result, clearly measured, is a better
paper than an unmeasured claim.

---

## 4. Forecasting instead of reacting

Nothing in the system currently anticipates anything. Everything is triggered by
a citizen noticing a problem.

- **Seasonal load:** drain complaints spike before the monsoon; the authority
  could pre-position crews. Time-series on complaint volume per category per
  sector.
- **Failure prediction:** a streetlight fixed three times in six months will
  fail again. Survival analysis over `Complaint` recurrence at the same
  location.
- **Contractor risk:** predict cost/schedule overrun at award time from a firm's
  history, rather than noticing at 145% drawn (which is where `PRJ-002`
  currently sits).

---

## 5. Blockchain — where it helps, and where it does not

Worth stating plainly, because this is the item most likely to be added for the
wrong reason.

**What we already have.** `services/audit.ts` implements a hash chain: every
event's SHA-256 covers its own canonical content plus the previous event's hash.
Editing or deleting any historical row breaks every hash after it, and
`verifyChain()` detects exactly that. This gives tamper-*evidence* — the same
integrity property people usually reach for a blockchain to get — with no
distributed ledger, no consensus, and no gas.

**Where a ledger genuinely adds something.**

- **External verifiability.** The chain proves nothing to an outsider today,
  because the authority controls the database and could recompute the whole
  chain after editing it. Periodically **anchoring the head hash** to a public
  chain (or any independently-held append-only log) fixes precisely this, and
  costs one transaction a day. This is the strongest case, and it is small.
- **Mutually distrusting parties.** Contractor payment against verified
  milestones is the honest candidate: the authority and the contractor have
  opposing incentives about whether work was completed. A smart contract
  releasing payment on a verified `WorkOrder` is a real use of the technology.

**Where it does not.** Storing complaints, citizens or work proof on-chain.
There is one writer, one reader, and a legal obligation to be able to delete
personal data on request — every one of those is an argument against a ledger.
Immutable public storage of a resident's phone number and address is a privacy
incident with extra steps.

**Recommendation.** Anchor the audit head; consider milestone escrow if the
contractor angle is pursued; keep everything else in Postgres.

---

## 6. Smaller things that need a model but not a research project

- **Photo quality gate** — reject a blurred or dark upload *at the point of
  upload*, while the worker is still standing at the site. Laplacian variance is
  enough; no training needed.
- **Duplicate photo detection across citizens** — two residents photographing
  one pothole from opposite pavements. Perceptual hashing plus the clustering
  from §2.
- **Voice complaints** — Whisper or IndicWav2Vec for citizens who would rather
  speak than type, which in this user base is most of them.
- **PII redaction** — faces and number plates in uploaded photos, before those
  photos are shown to anyone other than the officer handling the case.

---

## Suggested order

1. **Perceptual hashing** — small, no training, closes a live hole in
   verification that a re-encode currently walks through.
2. **Photo quality gate** — small, no training, saves a return visit.
3. **NLP routing and clustering** — biggest operational win per unit of effort,
   and the labels already exist in the routing history.
4. **Before/after CV verification** — the headline capability; needs the label
   set that §1 is already accumulating.
5. **The interpretability study** — do this once 3 and 4 are running, because it
   needs both models to compare against.
6. **Audit anchoring** — a day's work, whenever external verifiability is
   wanted.

Forecasting (§4) and escrow (§5) are genuinely later.
