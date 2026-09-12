# Pending work — what is deliberately unfinished

> **This file describes the system as it stood before the NYC 311 rebuild.** It
> is still accurate for `main` and `archive/noida-model`, and the findings in it
> — the autonomy gate that could automate nothing, the audit-chain defects, the
> recurrence signal that measured volume — stand and are cited by the paper. The
> product surfaces it lists (the simulated corpus, the classifier, the traffic
> simulator) were removed in Phase 1 of the rebuild. For what exists on
> `rebuild/nyc-311`, read the README and
> [research-decisions.md](research-decisions.md), Phases 0 to 8.

The running ledger of everything in DRISHTI-G that is **not** finished, so that
no screen ever lies about its own maturity. Three kinds of entry live here:

1. **Being built** — the structure exists, the data does not. These must render
   an honest "being built" state in the UI, never an empty table pretending to
   be a real one.
2. **Needs real data** — the logic is written and running, but it is calibrated
   on seed data and cannot be trusted until it has seen the real thing.
3. **Deferred by decision** — we chose not to build it for the prototype.

Anything requiring a *model* rather than a rule lives in the sibling file
[advanced-capabilities.md](advanced-capabilities.md); this file is about
structure and product surface. Anything requiring *real-world data* — the
boundaries, the citizen charter, the posting register — and the surfaces to be
removed before that work starts live in
[real-world-readiness.md](real-world-readiness.md). The three are
cross-referenced.

---

## 1. Being built — no real data yet

### Field-worker mobile surface
**State.** Code-based access exists at `/w/[code]` — no account, no password.
**Missing.** The phone-shaped upload view, offline tolerance, and SMS delivery
of the code.
**Deferred by decision.** Street labour is contractual; giving it accounts was
tried and removed. See "Removed surfaces" below.

---

## 2. Needs real data before it can be trusted

These are running on honest baselines and are safe to demo, but every one of
them is a placeholder for something measurable. Full treatment of each is in
[advanced-capabilities.md](advanced-capabilities.md).

| Area | Running today | Waiting on |
|---|---|---|
| Proof verification | EXIF freshness, GPS proximity, duplicate-file detection | Before/after image comparison; real photo corpus |
| Duplicate detection | Token-overlap text similarity + radius clustering | Real complaint text; learned embeddings |
| Priority scoring | Weighted rule over category, support count, age | Real outcome labels — which complaints actually mattered |
| SLA deadlines | Fixed hours per category | Observed resolution times per unit and category |
| GRIE risk weights | Hand-set, auditable weights | The paper's whole question: do learned weights beat these, and by how much |
| Sector centroids | Seeded approximations | Real ward/sector boundary polygons |

**What the traffic simulator changes here, and what it does not.** Four of these
now have a *volume* of observations where they previously had almost none:
duplicate detection runs against thousands of complaints written in varied,
misspelled, bilingual text rather than a handful of seeded rows; priority scoring
has a spread of ages and support counts; SLA has observed resolution times per
unit and category; proof verification has run against every field submission.
That is enough to build and judge the W3 models on, and enough for the screens.

It is not enough to *trust* any of them, and the rows above stay exactly as
written. The observations come from the simulator's own parameters — a
distribution someone chose — so a model that fits them well has learned those
parameters, not municipal reality. What "waiting on" means for each row is
unchanged: real complaint text, real outcome labels, real boundaries.

---

## 3. Removed surfaces — do not rebuild

Recorded so these are not re-added by accident.

- **Neo4j, and the whole graph projection.** `graphSync.ts` wrote complaints,
  units and officers into it and `system.ts` health-checked it; nothing in the
  codebase ever read from it — there was no `MATCH … RETURN` anywhere outside
  `RETURN 1`. It cost a container, 512 MB of heap, two published ports, a driver
  dependency and a sync hop on every complaint write, and returned no feature.
  The org tree is a recursive CTE in Postgres, which is what it should be.
  Re-introduce a graph only when a real multi-hop question exists *and a screen
  asks it*.
- **Works management — contractors, projects, inspections.** Three and five
  seeded rows, no acquisition path, and GRIE scoring them on invented history.
  This is a larger product than the grievance ecosystem, and a hollow version of
  it inside this one made the whole system read as a mock-up. The **models stay
  in the schema, dormant**; what went is every surface over them — the console
  screens, the API endpoints, the nav entries, the crew screen's contractor
  picker, and the `PROJECT`/`CONTRACTOR` risk factor sets. Both enum values
  survive in `RiskEntityType` so historical `RiskScore` rows still read, but
  `ScorableEntityType` now excludes them, `/risk/queue` filters them out, and
  the type system refuses any new scoring of them.
- **The citizen's category picker on the new-complaint form.** A citizen supplies
  no category. Asking them to choose meant asking them to know the difference
  between Public Health and Jal Vibhag, and `resolveCategory()` short-circuited
  on their answer — which filled the routing history with citizen guesses rather
  than with what the classifier actually decided, destroying the one signal that
  would let the classifier improve. Replaced by a **confirmation shown after
  classification** ("we have sent this to Electrical — is that right?"), backed
  by `POST /complaints/:id/category`. Corrections record both halves — what the
  engine chose and what the citizen chose — which is the labelled disagreement
  worth learning from.
- **`/officer/map`.** It and `/admin/map` rendered the same component over the
  same two endpoints and differed only in the sentence at the top. Both feeds
  were already scoped to the caller's subtree, so the second page was adding a
  URL rather than a capability. One screen at `/admin/map`, which reads the
  viewer's rank for its own description.

- **Field-worker accounts and the `/worker/*` portal.** Replaced by expiring
  per-job codes at `/w/[code]`. Street labour is contractual and rotates; issuing
  and deprovisioning accounts for it was never going to survive contact with
  reality.
- **The legacy geography screens** (`/admin/console/city` and its zone, circle
  and sector pages) and **`/admin/sectors`** and the old **`/admin/org` chart**.
  All three were readings of the same structure; there is now one tree screen at
  `/admin/org` that renders any depth. The old URLs are kept as redirects that
  resolve a pre-tree id to its unit, so stored links keep working.
- **`/officer/*` as a separate application.** The desk, crew and inspection
  queues remain, but the org view is now the same screen every officer uses,
  entered at their own posting.
- **Fixed Zone → Circle → Sector geography and the 8-value `Rank` enum.**
  Replaced by a recursive org tree whose depth each department configures. See
  the org-model section of the README.

---

## 4. Structural decisions taken

Recorded so they are not silently re-opened.

- **One shared spine, per-department depth.** A sector is one `OrgUnit` row for
  the whole authority. A department declares which depths it operates at via
  `DepartmentLayer`, so Civil can run three layers and Public Health two without
  duplicating geography or making a citizen's address ambiguous.
- **Three layers by default: City -> Zone -> Sector.** The minimum that still
  shows an escalation travelling more than one hop.
- **Work circles dissolved.** The old Zone -> Circle -> Sector geography had a
  fourth tier. Layer count is now a per-department setting rather than a schema
  fact, so circles were collapsed and their 18 Circle Officers re-posted to the
  zone that contained their circle. Nobody was dropped.
- **Only a leaf dispatches work.** Structural, not configurable: dispatching
  from a parent unit would skip the officer who knows the ground.
- **Data migrated in place, not reseeded.** All 161 complaints, 206 postings,
  169 citizens and 120 crew were repointed onto the tree with zero orphans, so
  the risk queue and audit chain stay meaningful.

## 5. Live demonstration of configurable depth

**Horticulture Department is deliberately configured to two layers**
(City -> Ward, dispatching at depth 1) while every other department runs three
(City -> Zone -> Sector, dispatching at depth 2). Both sit on the same shared
map of the city. This is left in place as working proof that layer count is a
setting rather than a schema fact — reset it from the department's Layers screen
if a demo needs everything uniform.

The rule that makes this work is worth stating, because it is subtle: a unit may
dispatch when it is at the **department's** deepest configured layer, not when
it is a leaf of the tree. Keying it to the tree's leaves would have left every
short department unable to dispatch anywhere at all.

## 6. What the corpus can and cannot support

Two models were built against the same simulated data and they came out
opposite ways. The difference is worth understanding, because it decides what
Wave 4 can be built on.

### The classifier cannot be evaluated — the text corpus is too uniform

W3.1's premise is that a trained classifier replaces GCCE's keyword matcher. On
this data it does the opposite.

| Split by distinct phrasing | Accuracy |
|---|---|
| Trained classifier (TF-IDF + multinomial NB) | **10.8%** |
| GCCE's keyword matcher, same held-out rows | **82.4%** |

Seventy points *worse* than the thing it replaces.

**Why the first number was 100%.** A row-level split reported perfect accuracy,
which was memorisation wearing a rosette. `sim-catalogue.ts` holds about thirty
hand-written phrasings, so 1,094 labelled complaints share **23 distinct texts,
roughly 48 copies of each**, every one mapping to exactly one category. A random
split puts verbatim copies of every test example into training; the model only
has to recognise which of twenty-three strings it is looking at.

Grouping by text asks the real question — can it categorise a phrasing it has
never seen — and with sixteen phrasings in training and seven held out, it has
not seen most of the vocabulary it is tested on. Hand-authored keywords
generalise across phrasings by construction, which is why the matcher wins.

**This is a finding about the corpus, not the model.** No tuning fixes 23 texts.

`CLASSIFIER_ENABLED` is `false` and deliberately not an env flag — a flag
invites someone to flip it without reading why it is off. A test asserts it is
off, so switching it on comes with a failing test attached.

To unblock: a corpus with hundreds of distinct phrasings (and *not* generated
combinatorial variations, which would only teach the generator again), or enough
citizen-confirmed labels to train on genuine supervision. There are 441 answers
after 45 simulated days, but they are answers about the same 23 texts.

### The SLA estimator ships, with a caveat about what its numbers mean

W3.3 replaces `category.defaultSlaHours` — one number per category, identical
in a sector with four open jobs and one with six hundred — with observed
quantiles per category x unit x priority, backing off when a bucket is thin.
`p90` becomes the deadline; `p50` becomes the sentence the citizen reads.

From 1,300 resolutions: **99 buckets** — 44 at category x unit x priority, 45 at
category x unit, 10 at category. `MIN_SUPPORT` is 10, below which the estimate
backs off rather than trusting a p90 computed from three cases.

| | Breach rate |
|---|---|
| Under the seeded deadlines | **60.2%** |
| Under a learned p90 | **10.4%** |

A p90 deadline is *supposed* to breach about a tenth of the time — that is what
makes it a promise rather than an aspiration, and it is worth saying before
someone reads 10.4% as a failure.

The per-category table shows where the seeded numbers were fantasy:

| Category | Seeded | p50 | p90 | Breach at seeded |
|---|---|---|---|---|
| Hanging or Broken Cable | 12h | 49.6h | 103.1h | 95.7% |
| Dead Animal Removal | 6h | 54.7h | 113.5h | 94.6% |
| Garbage Not Collected | 24h | 53.8h | 110.1h | 93.3% |
| Pothole / Damaged Road | 72h | 50.4h | 100.8h | 26.5% |
| Damaged Footpath | 96h | 54.6h | 90.9h | 9.1% |

**The caveat, and it is not a small one.** These resolution times come from the
simulator's own delay distributions. "The seeded SLA is wrong" is therefore two
sets of invented numbers disagreeing with each other, not a finding about
municipal work. What is real and shipped is the **mechanism**: the system now
learns its promises from what it has observed, reports a range rather than a
point, and words the range according to how specific the evidence is. Point it
at real resolution history and it produces real deadlines; point it at this and
it produces the simulator's.

One genuine observation survives the caveat, because it is structural rather
than numeric: **the seeded targets are ordered wrongly.** Fast-sounding
categories were given the tightest deadlines (6h for a dead animal, 12h for a
hanging cable) and slow-sounding ones the loosest (96h for a footpath), on the
apparent assumption that urgency and duration are the same thing. They are not.
Urgency belongs in `priority`, which the system already computes separately. A
deadline should reflect how long the work takes, and nothing in the seed was
derived from that.

### The predictor works — the process corpus is genuinely informative

W3.2 was expected to hit the same wall and did not. The reason is that the
lifecycle is a nine-state machine with constrained transitions, so a small
number of trace variants is not a sampling artefact — it is what the domain
looks like. The question is not how many variants there are but whether the task
is hard enough to be worth predicting.

| Held out by case | Accuracy |
|---|---|
| Counting model with backoff | **0.815** |
| Gradient boosting, same split | **0.815** |
| Difference | **0.000** |

A learned model does not beat counting, which matches Weytjens & Weber (BPM
2026) and makes the explainable model free. That is a citable result rather than
a convenience.

**The calibration is what matters, and it holds:**

| Confidence | n | Accuracy |
|---|---|---|
| 0.95–1.00 | 170 | 0.976 |
| 0.80–0.95 | 854 | 0.924 |
| 0.60–0.80 | 605 | 0.664 |
| 0.00–0.60 | 97 | 0.515 |

Monotone, with the top band nearly twice as reliable as the bottom. **Wave 4's
autonomy gate thresholds on exactly this number**, so this table is the evidence
that a gate is possible at all. Had it been flat, the gate would have been
theatre and the second paper would have needed re-angling before a line of it
was built.

A small operational note on all three model services: the exported spec is
loaded once, lazily, and a failure is cached for the life of the process. Train
a spec while the API is already running and the service will not pick it up
until it restarts. Correct for production, where the spec ships with the build;
mild friction in the dev loop, and the reason a freshly trained model can appear
to do nothing.

Still outstanding for the paper: the LSTM and Transformer comparison. This
project does not carry torch, so the learned baseline here is gradient boosting.
That is enough to show a learned model does not pull ahead; it is not the deep
comparison the buildbook asks for.

---

## 7. The autonomy gate cannot automate anything, and that is the result

Wave 4's premise is that a gate combining prediction confidence, the actions
policy permits, and an action's risk class can safely automate routine work.
Built and calibrated, it automates nothing. The reasoning is worth keeping
because it took two corrections to reach.

### The calibration

`conformal.py` picks each threshold so the observed error among admitted
decisions stays within a stated tolerance, measured on held-out cases. On 2,309
cases:

| Class | Tolerance | Threshold | Error | Coverage |
|---|---|---|---|---|
| LOW | 10% | 0.55 | 3.7% | 80.3% |
| MEDIUM | 5% | — | — | **none works** |
| HIGH | 1% | — | — | **none works** |

For MEDIUM there is no confidence level down to a coin flip at which the error
is acceptable, and it is **anti-calibrated** — error rises from 18.8% to 27.2%
as confidence goes from 0.80 to 0.90. A stricter bar admits worse decisions.

### The correction that decided it

`AWAITING_VERIFICATION` was first classified LOW. In this system that status is
written **only when a crew submits work with proof**, which the verification
checks then score. Automating it would have the system assert that work happened
in the field — no crew, no photograph, no evidence.

Corrected to HIGH, and with that correction **every status transition is medium
or high risk**, because every one is a claim somebody should be willing to stand
behind. The only LOW member left is `<END>`, a prediction that a case is over
rather than an action to take.

The buildbook's low-risk examples — notify, cluster, re-prioritise — are not
status transitions at all. They are side effects the system already performs
automatically and which never needed a gate. **The gate was specified over the
wrong action space.**

### What was built instead

An advisory component. It evaluates every open complaint on an hourly sweep,
records its verdict as a `Decision` (`NEXT_ACTION`, `source: 'autonomy'`), and
executes nothing. No kill switch, no reversal window, no `source: 'autonomy'` on
audit events — that machinery exists to make executions safe, and there are no
executions.

What it produces is still worth having: a review queue ordered by how uncertain
the system is rather than by age, and a record against which a future
calibration can be argued. If a later dataset shows a class can be safely
automated, the case for turning it on gets made from these rows.

### What the first live sweep found, after a second correction

    considered 1009   assessed 597   wouldAutomate 0   needsReview 597
    noPrediction 412  forbiddenTopPick 0   predictedFinished 478

The first run reported `forbiddenTopPick: 478` and that was wrong. The gate was
conflating two different things: a model predicting `<END>` for an open
complaint means it expects the case to be *over* — a claim about the case, often
a right one — and the wrapper had removed `<END>` before the gate saw the list
because it is not an action. Reporting that as "policy rules out your top pick"
read as a constraint violation, which is the one metric the component exists to
count. It inflated the headline forty-fold.

Corrected, **the gate prevented zero constraint violations on the live open
register.** That is consistent with W0.2's verdict on BPIC 2015 and with the
overlap seen here: conditioning on the feasible set is not doing observable work
in this system.

The 478 is a real signal, just a different one: **the model thinks 478 of 597
assessed open complaints look finished.** Complaints sitting open whose history
resembles a completed case is a staleness measure a supervisor would want, and
it arrived by accident.

### What this means for paper 2

The original claim — that conditioning confidence on the permitted set raises
safely-automated coverage — is not supportable on this evidence. Two independent
datasets say the curves do not separate.

What is supportable is narrower and still worth writing: *a gate whose
thresholds are derived rather than asserted, applied to a real municipal
workflow, finds that no status transition in it can be safely automated, and
says why.* A negative result with a measured argument behind it, plus the
observation that the interesting action space for automation in such systems is
side effects rather than state transitions.

---

## 8. Wave 5 — what the acceptance run found

`npm run accept` drives the whole lifecycle through the real HTTP API and
reports per step. **11 of 11 automated steps pass.** Two things it found are
worth keeping.

### `docker compose up` did not bring the system up

The acceptance criterion says compose brings the whole thing up from a clean
machine. It brought three *processes* up against an empty database: no
migrations ran anywhere, the API image's `CMD` is `npm run dev`, and nothing in
the compose file or the Dockerfile touched Prisma. Every query would have
failed and the web app would have rendered errors.

The same class of defect as the README setup sequence, and found the same way —
by actually doing the thing rather than reading the file.

Fixed with a one-shot `setup` service that runs the documented sequence
(`prisma:deploy` → `seed` → `org:build` → `migrate:crew` → `org:roles`) and an
`api` that waits on `service_completed_successfully` rather than merely on
Postgres being reachable. The order is not arbitrary: `org:roles` refuses to
retire field-worker postings until `migrate:crew` has created the crew records
they become, which is why it is one command rather than four services racing.

Verified against a throwaway database: 5 migrations, seed, tree built, 50 work
orders, 86 active postings, org root "Noida".

### The crew surface leaks nothing, and now that is a test

Step e5 failed first because the run assumed `/work/:code` returns the
complaint's reference number. It does not — the crew page exposes the job, the
place and the instructions, and **nothing identifying the citizen**. That is the
right design for a page reachable by anyone holding an eight-character code, so
the assertion was inverted: the run now fails if `referenceNo` or `citizen` ever
appear in that response.

### Two criteria that cannot pass as written

**e3** says routine cases are auto-handled and labelled as such. Nothing is
auto-handled — Wave 4's measured conclusion, not a gap — so the step reports
what actually happens: the gate assesses and recommends a human, with its
reason.

**e8** contains the run's only shortcut. It pushes a deadline into the past so
the escalation sweep has something overdue, standing in for waiting two days.
Marked as such in the code.

---

## 9. Blocked, and what each needs

Three things are stopped rather than merely unfinished. Everything else in this
document is work; these are decisions.

| Blocked | What it is waiting on | Who decides |
|---|---|---|
| **W2.3**, the third feedback signal | An officer-facing re-route endpoint. Before it can be written: *may an officer hand work to a peer department, or only escalate upward?* Letting a Junior Engineer pass work to Electrical is a governance change, not an endpoint. | Author |
| **GRIE's repeat rate** | It measures volume, not repetition. Fixing it changes Paper 1's treatment, so either the definition changes and the study is re-run, or it stands and the paper states the limitation. | Author |
| **Reusing `clusterId`** as the repeat signal | The clustering engine groups under 1% of complaints. Diagnose whether that is the simulator's uniform text or thresholds set for seed-scale data — on real text, not simulated. | Diagnosis first |

Two more are engineering rather than decisions, but gate later waves:

- **One filing request in ten fails under sustained load.** Appeared in the same
  run as the audit advisory lock first meeting full concurrency. Diagnose before
  Wave 4 adds another writer.
- **The map has no marker clustering**, so it caps at 1,000 pins. Fix before the
  autonomy console adds a second dense view over the same data.

---

## 10. Still open

### Two defects the traffic simulator found in the audit chain

Both were invisible until the system was driven at volume. Both are in shipped
code, not in the simulator, and either one alone makes `verifyChain` fail — which
is the acceptance criterion the whole audit design exists to satisfy.

**1. `audit.record()` is not atomic, so concurrent writes fork the chain.**
It reads the newest row to get `prevHash`, then inserts. Two transactions that
overlap both read the same head and both write it as their predecessor, so the
chain branches. On a 1,600-complaint run, **410 hash values were used as
`prevHash` by more than one row and 485 entries failed the link check.**

The concurrency is not the simulator's doing. Filing a complaint fires
`scheduleUnitRescore()` after the transaction commits, deliberately un-awaited,
and the in-process scheduler runs escalation every 15 minutes, verification
every 30 and clustering every 60. Any of those overlapping a user request is
enough. A single busy afternoon in production would do the same thing.

The fix is to serialise the write. A Postgres advisory lock taken at the top of
`record()` and held to commit (`pg_advisory_xact_lock`) is the smallest correct
version: it costs nothing when there is no contention, and it makes the
read-then-append genuinely atomic. Adding a unique index on `prevHash` would
turn the corruption into a visible error rather than silent damage, and is worth
having as well.

**2. Deleting a user silently rewrites the hashed content of their audit
entries.** `AuditEvent.actorId` is `onDelete: SetNull`, and `actorId` is one of
the seven fields `canonical()` hashes. So removing an account nulls that column
on every entry the account produced, and every one of them stops verifying —
with the reason "this entry's contents no longer match its fingerprint — it was
edited after the fact", which is exactly right and exactly what the schema just
did. **273 entries in the development database were destroyed this way** by a
`--reset` that deleted 120 synthetic residents. That damage is not recoverable:
the original `actorId` values are gone, and the hash cannot be recomputed
without them.

Deleting a user is an ordinary administrative act — a mistaken account, a
duplicate, an erasure request. Doing it must not break tamper-evidence.

The options, roughly in order of preference:
  - Change the relation to `onDelete: Restrict` and make user removal a
    deactivation, which is what the product does everywhere else anyway.
  - Stop hashing `actorId` and hash `actorLabel` instead. It is already stored,
    it is already a snapshot rather than a live reference, and it survives the
    person's account.
  - Keep both, but store a hashed copy of `actorId` that no cascade can touch.

Until one of them is done, the simulator refuses to delete residents and reuses
them across runs, and any database that has had a user deleted has a broken
chain that only a re-seed will clear.

### The citizen could disagree with the classifier but never agree with it

Found by W2.1, the moment the decision table produced its first agreement rate:
CATEGORY read **0%**, and so did ROUTE.

`POST /complaints/:id/category` threw 422 — *"that is already where this
complaint sits"* — when the category came back unchanged. The confirmation step
shown after filing therefore had exactly one outcome the system could record:
disagreement. Every label the classifier ever received was one of its own
mistakes.

That is not a cosmetic gap. A model trained on it learns where it goes wrong and
nothing whatever about where it goes right, and the 0% agreement rate was
literally true for the worst possible reason — agreement was unrepresentable.

Fixed. The same category coming back is now recorded as an endorsement: the
CATEGORY decision resolves to CONFIRMED, an audit entry is written, and the
complaint is returned untouched with no re-route, because nothing changed. The
simulator now drives both answers — roughly 45% of citizens answer the prompt at
all, and about one in eight of those disagrees — and the rate reads **67%**.

**ROUTE still reads 0%, and cannot be fixed the same way.** Confirming a routing
means an officer saying "yes, this is correctly mine", and there is no
officer-facing action for it — the same gap as the missing re-route endpoint,
below. Until that exists, the routing signal is override-only and anything
trained on it inherits the same one-sidedness the category signal just lost.

### Escalation dates the next deadline from real time, which empties the register

Found by W1.3. `escalateComplaint` sets the new deadline as `Date.now() +
layerSLA`, which is right in production — the officer receiving the case gets
their full window starting when they receive it. In a simulated run the sweeps
execute after all the traffic, so all 1,963 escalations landed deadlines hours
or days into the **real** future, unmoored from the cases' own histories.

The visible result was a register with 2,554 open complaints and **zero** past
their deadline. The officer desk showed no urgency, "sectors needing attention"
sorted by a column that was all zeros, and GRIE's SLA-breach signal on open work
read nothing — on a dataset where 880 complaints had been left to breach on
purpose.

Fixed in `scripts/lib/sim-clock.ts` (`repairEscalatedDeadlines`), which
recomputes each escalated complaint's deadline as *its own escalation moment
plus the layer's allowance* — the same rule the service applies, on the right
clock. It now runs at the end of every simulation. `npm run
sim:repair-deadlines` applies it to a dataset produced before the fix existed,
so six months of traffic did not have to be regenerated for one column.

After repair: 784 of 2,554 open complaints are past their deadline, about 31%.

**Note for anyone reading a run's numbers**: this is the one place where the
simulated register is *constructed* to look right rather than arriving that way.
The escalations are real and their dates are real (in simulated time); the
deadline that follows each one is recomputed rather than observed.

### GRIE's repeat rate measured volume, not repetition — FIXED 10 Sept 2026

**Resolved.** The definition below was replaced with a recurrence test, the
officer-facing sentence was corrected to match it, and nine tests now pin the
distinction. `backend/tests/repeatSignal.test.ts`; full suite 186/186 green.
The original diagnosis is kept in full because it is the paper's example of a
signal that looked discriminating on seed data and was not.

**What it is now:** a complaint counts as a repeat if an earlier complaint of the
same category, in the same area, had *already been resolved* when it was filed —
the repair not holding. Complaints explicitly marked duplicate are excluded from
both sides of the ratio rather than added to the numerator, because simultaneous
reports of one problem are corroboration, not recurrence.

That distinction is the whole fix: ten potholes reported in one week are a wave
and score 0; one pothole reported, fixed and reported again scores as a
recurrence. The rate no longer moves with volume — a test files 5 complaints,
then 40 more of the same category, and asserts the rate is unchanged. Under the
old definition it went from 0.8 to 0.98 on volume alone.

**Consequence 3 below is narrower than it was written.** The research harness
never called this code: it reads the JSON spec for weights and curves, but takes
feature *values* from the BPIC log — where the analogue is a correct per-case
binary, "did this case enter the objections subprocess" — or from the generator's
calibrated sampler. No published number was ever computed from the broken
definition. The exposure was that the paper's prose described a factor the
shipped product computed differently, and that is now closed.

The label also changed, from "Repeat complaints" to **"Recurring issues"**, and
the sentence from *"X% of complaints here repeat an issue already reported in
this area"* to *"X% of complaints here report an issue this area had already
resolved once."* The second sentence is true of the number beside it.

<details>
<summary>Original diagnosis, kept for the paper</summary>


Found by W1.3, once there was enough traffic for it to show. It is the most
consequential thing the truth pass turned up, because `repeatComplaintRate` is
one of GRIE's five signals and GRIE is the subject of the interpretability
paper.

The definition, in `riskSignals.ts`:

    repeats = sum over categories of max(0, occurrences - 1)
    repeatComplaintRate = min(1, (repeats + explicitDuplicates) / counted)

With a fixed catalogue of **10 categories**, this has a ceiling of `(N - C) / N`
for a unit holding `N` complaints. At N = 100 that is already 90%. At N = 969 it
is 99%. The rate therefore approaches 1 for any unit busier than its category
list, whatever the quality of the work done there.

Measured across 18 ground-floor units on 4,436 simulated complaints:

| Unit | Complaints | Categories | Repeat rate |
|---|---|---|---|
| Sector 128 | 969 | 10 | 90.7% |
| Sector 71 | 538 | 10 | 90.3% |
| Sector 8 | 343 | 10 | 88.0% |
| Sector 18 (Market) | 300 | 10 | 89.7% |
| Sector 10 | 188 | 10 | 87.8% |

Median 87.8%, max 90.7%, and the only low value (16.7%) belongs to a unit with
almost no complaints. **The variance across units is explained by how much work
they carry, not by anything about how well they carry it.** A signal that cannot
separate a busy well-run sector from a busy badly-run one is not measuring what
its name claims.

It was invisible on seed data, and the reason is arithmetic: 161 complaints
across 18 sectors is about nine each, well under the ten categories, so the rate
sat low and looked discriminating. Only volume exposes it.

**Three consequences, in order of severity.**

1. *The explanation shown to officers is false.* The risk review queue says
   "93% of complaints here repeat an issue already reported in this area". No
   such finding was made. The clustering engine — which actually does look for
   repeated reports — placed 39 of 4,436 complaints into 35 groups, under 1%.
   The two numbers describe the same thing and differ by two orders of
   magnitude, and the wrong one is the one on screen. For a system whose stated
   value is that its risk scores explain themselves, this is the worst kind of
   defect: the score is defensible and the reason given for it is not.
2. *It contributes near-constant bias to every score.* A factor pinned at ~0.9
   for every busy unit adds a fixed amount to each of their scores. It does not
   randomise the ranking, but it does consume weight that a discriminating
   signal could have used.
3. *It affects Paper 1.* The study compares GRIE against black-box models on
   constructed data where the signals are generated, not computed — so the
   published numbers are not themselves wrong. But the paper describes this
   signal as a governance measure, and on live data it is not one. Either the
   definition changes and the study is re-run, or the paper states the
   limitation explicitly.

**Candidate fixes**, none applied — this changes the scoring model, which is
Paper 1's treatment, so it is the author's decision:

- *Repeat rate per category, not across them.* "The same category reported more
  than once in a short window in the same place" is the intuition the name
  carries. Bound it by time: repeats within, say, 30 days.
- *Use the clustering engine's answer.* `clusterId` already records complaints
  the system judged to be about the same thing. That is the real repeat signal
  and it is already computed.
- *Normalise by what saturation would predict.* Compare the observed rate to
  `(N - C) / N` and score the excess. Cheapest change, keeps the shape.

Whichever is chosen, re-run `npm run export:model` afterwards, because the
research harness reads the exported spec and would otherwise study a model the
system no longer runs.

</details>

### The seed writes timestamps in the future

Thirteen status-history rows created by `prisma/seed.ts` and `scripts/workers-to-crew.ts`
are dated ahead of now — "Work allotted to the sector crew and started on site."
on jobs the seed places as already in flight. Harmless on screen, because
nothing renders a countdown from them, but they are wrong in the event log and
they are the only future-dated rows left once the simulator's own timeline bugs
were fixed. `npm run sim:run -- --reset` does not clear them: reset is scoped to
simulated residents, and these belong to seeded citizens.

Worth fixing when the seed is next touched, because "no row may be dated in the
future" is the kind of invariant that is cheap to hold and expensive to
rediscover.

### Everything else


- **Filing does not write a `SUBMITTED` status-history row.** A complaint is
  created already in `SUBMITTED` — the schema default — so nothing transitions
  *into* that state and no history row is written. The first stored row is
  GCCE's `SUBMITTED -> ROUTED`. Nothing in the product notices, because the
  complaint timeline reads the status field for the current state. It only
  becomes visible once the history is treated as an event log: every case is
  missing its origin, pm4py reports start activities of `ASSIGNED` and
  `AWAITING_VERIFICATION`, and throughput measured from the log alone begins
  after routing rather than at filing.
  `eventLog.ts` reconstructs the row from `Complaint.createdAt`, which is
  exactly when the case entered `SUBMITTED`, and that fixes the log for every
  complaint already stored. The deeper fix is for the filing transaction in
  `routes/complaints.ts` to write the row itself — but it would only correct
  complaints filed afterwards, so the reconstruction is needed either way.
  Do both, and keep the reconstruction guarded by the "case already has its
  SUBMITTED row" test so they never double up.
- **Six seeded complaints start at `AWAITING_VERIFICATION`.** Their first
  history row does not come out of `SUBMITTED` at all, so the reconstruction
  correctly declines to invent one. That is the seed writing a lifecycle no
  citizen could produce, not a projection bug — but it means the seed is not a
  faithful sample of system behaviour, which is one more reason the traffic
  simulator (W1.2) drives the real API rather than writing rows.
- **No officer-facing re-routing endpoint.** `officer.ts` exposes `verify` and
  `dispose` and nothing else; the only reassignment path is
  `POST /console/complaints/:id/assign`, which is Super Admin only. Two
  consequences, both now measurable: W2.3's "officer re-routes away from where
  GCCE sent it" signal is produced by the console instead, so every override in
  the data was performed by a Super Admin rather than by the officer who saw the
  misroute; and there is no way at all to record a routing being *confirmed*,
  which is why ROUTE agreement reads 0%. Needs a policy decision first — may an
  officer hand work to a peer department, or only escalate upward?
- What happens to a unit's open complaints when the super admin deletes or
  merges that unit mid-life. `describeRemoval()` currently refuses the delete
  and lists blockers; merge/reassign is not built.
- Whether a person may hold postings in two departments at once (the `Posting`
  model allows it; no screen exposes it).
- How a citizen's home unit is set when their address falls outside every
  stored boundary.
- **The notifications endpoint is polled a dozen times per page load.** Looks
  like one fetch per mounted component rather than one per page. Not a
  correctness bug, but it should be a single shared fetch.
- **`/admin/complaints` and `/admin/console/complaints` are still two screens**
  over the same data, as are `/admin/people` vs `/admin/console/staff` and
  `/admin/departments` vs `/admin/console/departments`. They serve different
  audiences today (scoped officer vs Super Admin), which is why they were not
  merged in the same pass as the geography screens — but one scoped screen each
  is the right end state.
- The `/console/units/resolve/:kind/:id` endpoint exists only to forward
  pre-tree links. Delete it once no stored link refers to the old ids.
- **The geography editors are gone.** `console.ts` held 14 endpoints creating,
  renaming, deleting and drilling into three fixed tiers, plus three near-
  identical editor forms in the UI. All replaced by the org tree, where adding a
  layer is `POST /console/units` rather than a schema change. Roughly 620 lines
  removed across the two files.
- **`GET /geography` is the last legacy picker.** Six screens still use the
  zone -> circle -> sector tree to choose where to post someone or where to
  reassign a complaint. It needs replacing with a flat unit list off the tree
  before the legacy tables can be dropped.
- **GRIE scores the org tree.** `RiskEntityType.SECTOR` / `CIRCLE` / `ZONE`
  collapsed into a single `ORG_UNIT`: scoring an area does not change with its
  depth. What does change is the saturation threshold, which used to be three
  hand-set numbers (25 / 70 / 180) and is now computed — 25 open complaints per
  ground-floor unit beneath. That keeps the load factor meaningful at every
  depth instead of inert at the top and hair-trigger at the bottom, and it holds
  at whatever depth a department is configured to. All 36 historical scores and
  1 flag were repointed onto the tree with none lost.
- **`hierarchy.ts` no longer implements scoping of its own.** `sectorsInScope`,
  `departmentsInScope` and `hasJurisdiction` keep their signatures but delegate
  to `orgTree`, so there is one answer to "who is responsible for what". Two
  rules worth remembering: geographic scope is the subtree beneath a posting,
  and **department scope is the posting's department, not its depth** — a
  General Manager runs one department city-wide and must not read another's.
- **Dead allotment path removed.** `officer.ts`'s `/complaints/:id/workers` and
  `/allot` looked up a field worker's *posting* to hand out work. Those postings
  ceased to exist when street labour moved to per-job codes, so both endpoints
  could only ever fail. Allotment is `crew.issueWorkOrder`. `workersForSector`
  and the two dead api-client methods went with them.
- **Every posting must resolve to a unit.** Postings were being written with a
  null `orgUnitId` by all three writers (console appointment, staff creation,
  transfer), which produced an officer who routed nothing, appeared in nobody's
  scope and could not be escalated to — an appointment that behaved like a
  vacancy. `org.resolveUnitForPosting()` is now the only way a posting is
  written, and it refuses rather than saving a row that does not work. Guarded
  by five tests.
- **The citizen portal now runs on the org tree.** `homeSectorId` is superseded
  by `homeUnitId`; the profile and registration pickers write the new column and
  keep the old one in step. Community scope is `unit` / `area` rather than
  `sector` / `circle`, so it keeps working at any configured depth. The legacy
  `zones` / `circles` / `sectors` tables are now read only by the officer and
  admin screens and the `resolve` shim.
- The legacy `Rank` and `JurisdictionLevel` enums and the `zones`/`circles`/
  `sectors` tables are still present and still written by older routes. They are
  superseded by `OrgUnit` and must be removed once every route reads the tree.
  `Escalation.fromRank`/`toRank` are likewise historical and no longer written.
- ~~There are no tests.~~ **Done.** 58 tests across three files, run with
  `npm test`. They use a real `drishti_g_test` database (created by
  `npm run test:setup`), not mocks — a mocked Prisma would not have caught
  either of the scoping bugs the suite now guards. Covered: tree navigation,
  jurisdiction scope, per-department operating depth, rollup arithmetic,
  routing fallback, the escalation walk and its guards, and GCCE's category
  matcher and state machine. Not yet covered: verification, clustering,
  priority, GRIE, and the HTTP layer.

---

## 11. The simulated dataset

### The 180-day run, before and after

Both figures are the Super Admin overview, on the same code. "Before" is a
separate database (`drishti_g_before`) carrying nothing but the seed and the
three org scripts — it is what anyone following the README gets.

| | Before (seed only) | After (180 simulated days) |
|---|---|---|
| Complaints | 161 | 6,229 |
| Currently open | 98 | 2,554 |
| Past deadline | 35 (36% of open) | 784 (31% of open) |
| Awaiting inspection | 5 | 889 |
| Registered citizens | 169 | 319 |
| Escalations | 6 | 1,963 |
| Status-history rows | 833 | 24,295 |
| Audit entries | ~550 | 43,801, chain intact |
| GRIE review queue | *"Nothing is above the review threshold"* | 7 items |
| Busiest sector | Sector 5 — 17 open, 12 overdue | Sector 128 — 618 open |

The empty risk queue in the "before" column is the thing worth looking at. With
161 complaints, GRIE had nothing to flag, so every screen built on it rendered
its empty state and nobody could tell whether the engine worked. That is what
"it's all seed data" actually cost.


`npm run sim:run` drives the real HTTP API with months of plausible municipal
traffic: synthetic residents register and file, the officer GCCE actually chose
signs in and issues a work order, a crew member opens the code with no account
and uploads proof, the officer inspects it, the sweeps escalate what nobody
touched, and GRIE rescores the units. Nothing is written on anybody's behalf.

**What is real in that data:** every row's existence and content. A row is there
because the API decided to write it, using the same code paths a user reaches.
Routing decisions are GCCE's actual decisions. Escalations happened because a
deadline actually passed. Verification scores are what the proof checks actually
returned.

**What is not real:** the timestamps, and the population.

`scripts/lib/sim-clock.ts` rewrites each case's timestamps after the API has
finished with it, because the API stamps `now()` and six months of work that all
happened in one afternoon is useless for a log whose entire purpose is elapsed
time. It is env-gated (`SIM_TIME_TRAVEL=1`), refuses to run in production, and
writes nothing but timestamp columns.

The complaint text comes from about thirty hand-written phrasings in
`scripts/lib/sim-catalogue.ts`, weighted into a category mix that is **a
judgement, not a measurement** — there is no published NOIDA Authority complaint
breakdown to calibrate against. The same applies to every rate the simulator
takes as a parameter: a 15% SLA breach rate and a 10% override rate are
defaults chosen to exercise the machinery, not observed figures.

### What this data may be used for

- Training the in-system classifier, predictor and SLA estimator (W3).
- Filling the screens so they can be built and judged against realistic volume.
- Demonstrating that the engines run, including the autonomy gate (W4).

### What it may never be used for

**Evidence for any claim in either paper.** The data is produced by the same
system the papers evaluate, which is circular: a model that predicts this log
well has learned the simulator's parameters, not municipal governance. Every
number that reaches a paper comes from BPI Challenge 2015, or from
`research/drishti_research/generator.py` with its constructed nature stated in
the text. See `docs/research-decisions.md`.

A run is reproducible with `--reset --seed N`. Without `--reset` the second run
piles onto the first and the seed no longer determines the result.
