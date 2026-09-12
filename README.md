# DRISHTI-G

A municipal service-request system built as a faithful replica of **NYC 311**,
running on 355,430 real service requests, with our own layers added on top and
measured against it.

> **This is an academic replica built for research and coursework.** It runs on
> [NYC Open Data, 311 Service Requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9)
> (dataset `erm2-nwe9`), used under its published terms with attribution. It is
> **not affiliated with, endorsed by, or a substitute for** the City of New
> York's 311 service, it does not use the City's seal or wordmark, and it must
> never be used to file a request a member of the public could mistake for a
> genuine one.

## Why it is built this way

The system used to run on invented seed data with seventeen undeclared assumed
constants. That is dismissible in one sentence by any reviewer who reads the data
section, and no amount of engineering above it fixes the problem.

So the base system is now a replica of a real one. **Layer 0** contains only
concepts that exist in NYC's own published data — service requests, agencies, a
two-level taxonomy, community boards, a status lifecycle. It contains no ranks,
no sectors, no officers, no escalation and no risk scores, and that absence is
load-bearing rather than incidental: Layer 0 is the **control condition**. Each
layer we add on top is then worth a number, not an assertion — a measurable delta
against what a real city actually did with the same requests.

What NYC's data cannot show is who handled a request, what steps they took, and
whether the work was verified. That gap is precisely where the contribution
lives.

| Layer | Adds | What it was actually measured by |
|---|---|---|
| **0** | The replica: intake, routing, agency queues, status, geography | — it *is* the baseline |
| 1 | Officer identity, work orders | Coverage: 6,318 of 6,318 open requests have exactly one accountable officer |
| 2 | Escalation on SLA breach | Early-warning precision on NYC's own timestamps — 62.1% at half the service level |
| 3 | GRIE risk radar, and a routing *report* | Cross-validated AUC 0.807, calibrated; routing had nothing to learn (184 of 188 types go to one agency) |
| 4 | Photo verification | 4 false matches in 499,490 photograph pairs; 99.3% of re-saved copies caught |

**Every layer is built.** Three of those four measurements are not the ones the
plan asked for, and the reasons are the more interesting results: named
accountability has no resolution-time counterfactual in data that records no
case worker; "do our escalations coincide with what NYC closed late?" is a
tautology, since one derived deadline defines both; and NYC's taxonomy has
already solved routing, so there is nothing for a router to win. Each is
recorded in `docs/research-decisions.md` rather than quietly replaced.

## Quick start

```bash
docker compose up --build
```

That brings up Postgres, migrates it, seeds the reference data, and starts the
API on `:4000` and the web app on `:3000`. On Windows and macOS, edits to the
mounted source do not reach the running containers: restart the service after
changing code (`docker compose restart api`), or run the dev servers directly as
below. It does **not** import the corpus —
that is a separate, deliberate step, because it downloads and inserts 355,430
rows.

To run the pieces directly:

```bash
docker compose up -d postgres
cd backend && npm install && npm run prisma:deploy && npm run seed
```

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

### Loading the real data

The corpus is not vendored — it is 150MB of public data, re-pullable at any time.
Pull it once with the research harness, then import it:

```bash
cd research && python -m drishti_research.nyc_pull
```

```bash
cd backend && npm run import:nyc
```

The import is idempotent on the SR number, so re-running it changes zero rows.
`research/data/nyc/brooklyn.meta.json` records exactly when the corpus was taken
and which filter produced it, because NYC 311 updates daily and a study whose
input changes on every run cannot be replicated.

## Two things that will confuse you if nobody says them

### There is no `due_date`, and every SLA here is derived

NYC publishes a `due_date` column. It is empty for **every one of the 355,430
requests** in our slice — not sparse, zero — while being populated for other
complaint types entirely. That was verified against the dataset metadata rather
than inferred from a null count, because a query bug would have looked identical.

So every service level in this system is derived: the 75th percentile of observed
citywide closure time for that complaint type.

| Complaint type | Agency | Median close | **Derived SLA (p75)** |
|---|---|---|---|
| Sewer | DEP | 3.4h | **19.1h** |
| Water System | DEP | 6.9h | **47.6h** |
| Dirty Condition | DSNY | 35.4h | **95.2h** |
| Street Condition | DOT | 37.6h | **110.3h** |
| Missed Collection | DSNY | 77.2h | **159.3h** |
| Street Light Condition | DOT | 139.4h | **244.0h** |

**"Overdue" in this system therefore means "slower than the citywide norm for
this type", never "broke a promise the City of New York made".** Every screen
that shows an SLA figure carries that sentence with it, `RequestType.slaNote`
stores it next to the number, and the `SlaSource` enum makes a type without a
declared provenance impossible to write. The seventeen undeclared constants are
the reason all of that scaffolding exists.

### The system clock is not the wall clock

The corpus is a snapshot: requests filed 2022–2025, with their statuses and
closure times as NYC published them when the data was pulled on 2026-09-09. Ask
`Date.now()` whether one is overdue and every queue, age and breach figure is
quietly measured against a day the record does not describe — and nothing
throws. It looks exactly like a working feature.

So the system stands at a configured `SYSTEM_REFERENCE_DATE`, defaulting to the
**snapshot date** — the one moment at which every field of every row is true at
once — and *nothing* computes overdue from wall-clock time. The dates are never
shifted to look recent: doing so would destroy real seasonality, and garbage
complaints genuinely spike in summer.

The default used to be the last *intake* date, 2025-12-31. That was wrong, and
the verification script caught it: NYC closed 6,628 of these requests after 31
December, so standing there showed them as Closed on a day they were open.

One consequence worth knowing before you read the queue: at the snapshot date
nearly the whole open backlog is overdue. That is true — the newest request is
eight months older than the snapshot, against deadlines of ten days or less —
and it is not a sign the clock is broken. "Open" means NYC's published status
is not Closed, everywhere in the system, and overdue is always a subset of it.

The server prints the reference date at boot, `/api/v1/health` reports it, and
`npm run verify:import` fails if it stops matching the corpus manifest.

## What Layer 0 contains

| Route | Who | What |
|---|---|---|
| `/` | Public | Landing and an SR-number lookup |
| `/file` | Public | Intake: type → descriptor → location → channel |
| `/sr/[srNumber]` | Public | Status page for any request, no login |
| `/my/requests` | Citizen | Their own requests |
| `/agency/queue` | Agent | The working register |
| `/agency/sr/[id]` | Agent | Request detail and status actions |
| `/boards` | Agent | Per community board: volume, median resolution, backlog |
| `/map` | Agent | Clustered map of open requests |

Anyone can file a request and anyone can look one up, with no account. NYC 311
takes most of its reports by telephone from people who have never signed in, and
a replica that demanded a login first would not be a replica.

There are exactly two roles. A **citizen** files and tracks their own requests.
An **agent** works their agency's queue, with agency-level accountability and no
individual ownership — which is how NYC actually works, and also the only thing
its data can support, since it records no case-worker identity at all.

### Data model

| Entity | Note |
|---|---|
| `Agency` | DOT, DSNY, DEP. Three, not four — NYC has no public-toilet analogue, so seeding a DPR row would be inventing an organisation to match a table |
| `OrgUnit` | Borough → community board, depth 2. Council districts and police precincts *cross* board boundaries, so they are flat attributes rather than tree nodes |
| `RequestType` / `RequestDescriptor` | Two levels, 6 types and 130 descriptors. The previous system's taxonomy was flat, so this is a real migration |
| `ServiceRequest` | The core record. `isImported` separates New York's history from ours |
| `RequestStatusHistory` | One row per imported request — its arrival. Nothing more; see below |
| `User` | `isSynthetic` on every staff account |
| `AuditEvent` | SHA-256 hash chain, carried across the rebuild unchanged |

Every staff account is **synthetic** and marked so in the database and the UI.
NYC records no worker identity, so there is no real person to model, and nothing
here may present one as real.

### The audit chain, and the line it must not cross

The chain is append-only, each entry hashing its own content plus its
predecessor's hash, so editing or removing any historical row breaks every hash
after it. `GET /api/v1/audit/verify` walks it and reports the first row that
fails and why.

An imported request receives **one** entry: that it was imported. No invented
"assigned", "inspected" or "closed" events, and no actor. The chain's entire
value is that it is a record of *our system's* actions — fabricating history
would make the tamper-evidence claim worthless, and the same applies to
`RequestStatusHistory`, which feeds a process-mining event log that feeds a
paper.

Two constraints in the schema exist because both failures already happened: the
append takes a Postgres advisory lock (410 duplicated hashes and 485 broken links
on one run without it), and `AuditEvent.actorId` is `onDelete: Restrict` rather
than `SetNull`, because nulling a hashed field rewrites the content of every
entry a deleted user ever produced (273 entries destroyed that way).

## What Layer 1 adds — officer identity

NYC 311 holds an *agency* accountable for a request and records no person at all
— no case worker, no crew, no field worker. Layer 1 is the first thing that is
ours: one named officer answering for each open request, supervisors who assign
and reassign, and work orders that send a job to a crew with no account.

| Route | Who | What |
|---|---|---|
| `/officer/desk` | Officer | The requests this officer answers for, most urgent first |
| `/officer/sr/[srNumber]` | Officer, supervisor | The Layer 0 record, plus who answers for it and the jobs sent out — with a QR |
| `/supervisor/assign` | Supervisor | Unassigned requests, reassignment by SR number, and each officer's load |
| `/w/[code]` | A crew, no login | The job, and one button: it's done. The code is the whole credential |

Every Layer 1 screen carries a purple **Layer 1 · ours** mark, and every officer
and supervisor a **synthetic** badge. There are 60 of them, named for their post
("DOT Officer · BK-04") and never given a human name. NYC records no one to model
them on, and a plausible invented name is how a synthetic record starts passing
for a real one.

**How a request gets an owner.** It goes to the officer posted to its agency and
board, or to the lighter-loaded officer if a board has two. A request with no
board goes to the agency's borough duty officer. That matters: 180 open requests
have no board, 170 of them DOT's. New filings are assigned inside their own
filing transaction, and the 6,315 requests already open were given owners once
by `npm run layer1:assign`. Assignments are stamped in real time, so a 2022
request shows a 2026 assignment date. The system claims nobody held it in 2022,
because NYC records no owner to carry over.

**A crew's "done" does not close the request.** It's recorded against the work
order and shown to the officer, who closes the request through the ordinary
status change. "The crew says it's done" and "it's done" are different claims,
and nothing in Layer 1 can check the second. That's Layer 4's photo verification.

**How it's measured, and how it isn't.** The build plan proposed asking whether
named accountability changes resolution time on replayed requests. That can't
be done honestly here. NYC records no case-worker identity, so there's no real
officer behaviour to replay, and a simulated officer would be exactly the kind
of invented behaviour this rebuild exists to remove. So Layer 1 is presented as
a capability, and `npm run layer1:measure` checks four facts about this system:

| Check | Result |
|---|---|
| Coverage: every open request has exactly one accountable, correctly posted officer | **6,318 of 6,318 (100%)** |
| Latency: filing to first assignment, for requests filed since Layer 1 went live | **p50 288ms, p95 348ms** (3 filings) |
| Baseline: no Layer 0 source file references a Layer 1 concept | **clean** across 12 files |
| Chain: the audit chain verifies with Layer 1's entries in it | **6,549 entries** |

**Layer 0 stays the baseline.** Layer 1 attaches in exactly one place, a filing
hook registered in `app.ts`, and adds nothing to what Layer 0 returns, writes or
records. An assignment is not a status change, so it never enters the status
history that feeds the process-mining log. Delete the Layer 1 block in `app.ts`
and the baseline is back, unmodified. `npm run verify:import` still passes all
six checks after the backfill.

## What Layer 2 adds — escalation

NYC 311 records no escalation: a request sits with its agency until the agency
closes it. Layer 2 adds a ladder inside each agency — the accountable officer,
then the agency's supervisor once a request passes its derived deadline, then a
synthetic borough commissioner once it has been open for twice its service
level. Escalating brings someone senior in beside the officer. It never takes
the request away from them, and it writes no status history, because an
escalation is not one of NYC's statuses.

| Route | Who | What |
|---|---|---|
| `/supervisor/escalations` | Supervisor, commissioner | What climbed the ladder, highest rung first, with the reason |
| Escalation panel on `/officer/sr/[srNumber]` | Officer, supervisor | Who the request is with now, each rung and why, and a button to raise it |

**The sweep acts only on live requests.** Every open imported request is past
its deadline at the snapshot, and escalating all 6,315 of them the first time
the sweep ran would be reacting today to delays New York lived through years
ago. So it leaves NYC's history alone unless this system has since acted on a
request. A person can escalate before any breach, but only with a reason: that
sentence is all the senior person it reaches has to go on.

**Each record is judged at the moment it was observed.** NYC's rows at the
snapshot, requests filed here against the real clock. Before that rule, a
request filed through the replica could never be overdue and the sweep could
never fire (F-24).

**How it's measured.** The plan asked whether escalations coincide with the
requests NYC closed late. They do, 100%, by construction: the same deadline
defines both. So `npm run layer2:measure` reports that as the tautology it is,
and asks the question NYC's own timestamps can answer — would an earlier warning
have been right?

| Warning fires at | Flagged requests that end up late |
|---|---|
| a quarter of the service level | 43.9% |
| half | 62.1% |
| three quarters | 77.5% |

The live sweep has not had a breach to act on yet: the earliest deadline among
requests filed here is 15 September 2026 (F-37). Its behaviour, including two
sweeps overlapping, is covered by the tests.

## What Layer 3 adds — the risk radar, and a routing report

Both engines the project started with live here, and both came out of NYC's
data different from how they went in.

| Route | Who | What |
|---|---|---|
| `/admin/risk` | Administrator | Every agency's boards, month by month: the chance of being among the worst fifth for missed deadlines next month, why, and — where the corpus can say — what happened |
| `/admin/routing` | Administrator | Whether a model can route better than NYC's own taxonomy: the measurement, and the table it learned |
| `/admin/audit` | Administrator | The audit chain, with a button that verifies it |

**GRIE is trained in Python and run from a spec.** `nyc_grie.py` chooses between
candidates under grouped cross-validation by a rule written down before it ran,
calibrates the winner, and writes `backend/data/grie-spec.json`. The backend
computes the five signals from its own database in SQL, and
`npm run layer3:measure` checks that it reproduces the study's 2,538 unit-months
— every signal, the score and the probability. Writing that SQL from the study's
docstring is how a bug in the study itself was found (F-39).

| Candidate, grouped cross-validation | AUC | Within agency |
|---|---|---|
| Hand-set weights (GRIE as built for NOIDA) | 0.674 | 0.701 |
| **Tuned weights, caps re-derived from NYC — shipped** | **0.807** | **0.783** |
| This month's missed deadlines, alone | 0.820 | 0.789 |

Read the last row. Tuned on NYC, GRIE puts 80% of its weight on this month's
missed deadlines, and the other four factors sit at the 5% floor that keeps them
in the explanation. That floor costs 0.0125 AUC (95% interval 0.005 to 0.020):
the single factor ranks boards better (F-38). What NYC's data lets you predict is
mostly a unit's missed-deadline rate persisting into the next month. Shipping the
single factor instead would be an export, not a code change.

The register shows the calibrated chance and never the bare score, which only
ranks: raw, the score averaged 25.8% against an observed 20.0%; calibrated,
20.1%. Of 220 units flagged where the next month is on record, 172 (78%) did
land in the worst fifth.

**GCCE is a report, not a router.** NYC's complaint types are defined per agency,
so choosing the type chooses the agency — for 184 of the 188 filed in Brooklyn in
2024. On the four that are shared, a lookup table beats always choosing the usual
agency by 1.9 points on 2025, entirely where NYC's own descriptor names the
agency; nothing known at intake predicts Encampment or Highway Condition.
Running it live would reproduce NYC's menu, so `nyc_routing.py` measures it and
`/admin/routing` reports it.

## What Layer 4 adds — proof of work, and its limits

NYC closes a request with a sentence of agency text: no photograph, nothing a
resident could check. Layer 4 asks the crew for a picture, and then asks what a
picture can honestly prove.

Not that the pothole is filled. **No check here looks at what the photograph
shows.** What they can establish is that a submission is not what it claims, and
that covers most of what going wrong looks like in the field:

| Check | Weight | What it establishes |
| --- | --- | --- |
| A photograph was sent | 25 | Something is attached at all |
| The photograph is new to this job | 25 | Not already sent against another job, re-saved copies included |
| Taken after the job was sent out | 20 | From EXIF, when the phone leaves it |
| Taken at the reported location | 15 | From EXIF, within 500 m of where the request was filed |
| Sent before the deadline | 15 | Against the derived deadline, since NYC publishes none |

Two of those are disqualifying rather than merely negative: nothing attached, and
a photograph already used elsewhere, are evidence that this is not proof. The
rest are weighed, and a check that *could not run* — most phones strip EXIF —
scores half and says so rather than counting as a failure.

Then the judgement goes to a person, and the order matters. The resident who
reported the problem is asked first, because they can see the street; their
answer outranks every check above, in both directions. An officer is called only
when the resident disputes the work, or when weak proof goes unanswered for 48
hours. Routing every closure across an officer's desk is the bottleneck that
makes these systems rot, so `/officer/verify` holds only what genuinely needs a
person, and is usually empty.

### The recycled-photograph check, and what it cost to set

Sending an old picture again is the easiest way to fake a closure, and an exact
file hash catches it only until the crew's gallery app re-saves the file. So each
photograph also carries a 64-bit difference hash, and two photographs count as
the same one when at most **4 of those 64 bits differ**.

That threshold is measured, not chosen: on 1,000 real civic photographs
(QR4Change, CC BY 4.0) and 499,490 pairs of different photographs —

| At 4 bits | Result |
| --- | --- |
| Different photographs wrongly matched | 4 in 499,490 pairs (0.0008%) |
| Re-encoded by a gallery app | 99.3% caught |
| Resized to half | 91.9% caught |
| Brightened | 95.5% caught |
| Cropped by 10% | 5.6% caught |

The rule was fixed before the run: take the largest threshold whose false-match
rate stays at or below one in 100,000, because refusing an honest crew standing
at a finished job is the worse error. **Cropping defeats this hash** — that is a
stated limit, not a gap to be tuned away — and the measurement comes from Pune
street photography, not from New York and not from pictures of repairs.
`npm run layer4:measure` reproduces all of it; the threshold ships in
`backend/data/proof-spec.json`, and without that file the check still runs on
exact file identity and says that is all it did.

### Screens

| Screen | Who | What |
| --- | --- | --- |
| `/w/[code]` | The crew, no account | Attach up to three photographs through the phone's camera, and read what each check found |
| `/sr/[srNumber]` | The resident who reported it | See what the crew sent and answer whether it was done |
| `/officer/verify` | Officer, supervisor | Only disputes and unanswered weak proof; accept, or send it back with a reason the crew is shown |

## Proving it still works

```bash
cd backend && npm test
```

Each layer also has a check that runs against the real corpus:

| Command | What it proves |
|---|---|
| `npm run verify:import` | Layer 0: the corpus matches NYC's source, and the audit chain holds |
| `npm run layer1:measure` | Every open request has exactly one correctly posted officer |
| `npm run layer2:measure` | Escalation fires on breach only, and never on NYC's history |
| `npm run layer3:measure` | The backend reproduces the study's risk model on every unit-month |
| `npm run layer4:measure` | What the recycled-photograph check is worth, on real civic photographs |

Tests run against a real Postgres database, `drishti_nyc_test`, not a mock. The
logic worth testing here is all queries — the chain under concurrency, the
register's filters, routing over a real tree — and a mocked Prisma would only
assert that we call the functions we already know we call.

`SYSTEM_REFERENCE_DATE` is pinned in the test config, so "overdue" is
deterministic rather than passing today and failing tomorrow.

## The research harness

`research/` holds the Python study, run as `python -m drishti_research.<module>`.
It never runs in the request path: models are trained in Python, exported as a
JSON spec, and executed in TypeScript, which is what lets the paper claim the
evaluated model *is* the shipped model.

| Module | What it answers |
|---|---|
| `nyc` | The Socrata client. Bulk pulls go through the **CSV export** endpoint, not JSON — see the note on `EXPORT_PAGE` |
| `nyc_coverage` | V1: is there a `due_date`? (No.) |
| `nyc_pull` | V2: the frozen corpus and its manifest |
| `nyc_sla` | The derived SLA table, and the declaration that travels with it |
| `nyc_signals` | V3: the 2,538 unit-month panel, five GRIE signals, forward-looking label |
| `nyc_persistence` | V4: is the target forecastable at all? |
| `nyc_study` | V5: the interpretability comparison |
| `bpic*` | The BPI Challenge arms, kept as the cross-domain comparison |

Findings live in [`docs/research-decisions.md`](docs/research-decisions.md),
append-only: a decision that later turns out to be wrong gets a new entry
underneath, never an edit.

### What Phase 0 decided

The corpus clears every feasibility check. Target persistence is **AR(1) =
+0.7703**, above the BPI Challenge 2015 panel and well clear of the +0.30 floor
below which no model beats chance. The panel is **2,538 unit-months**, roughly
ten times the 268 that left the earlier arm underpowered.

The interpretability result did **not** replicate — and this time the panel was
large enough to detect it:

| Model | test AUC |
|---|---|
| Logistic regression | **0.8189** |
| GRIE (tuned weights) | 0.8117 |
| Gradient boosting | 0.8097 |
| Random forest | 0.8078 |
| **GRIE (hand-specified)** | **0.6869** |

GRIE as shipped is 0.123 behind gradient boosting, CI [−0.147, −0.098]. But the
failure is not interpretability's: the best model on this panel is a *logistic
regression*, and GRIE with tuned weights — still a weighted sum of the same five
explainable factors — reaches parity with both black boxes.

What fails is the hand-chosen weighting. Two of GRIE's factors correlate
*negatively* with failure on this corpus while carrying 47% of its weight
pointing the wrong way. **The weights encode NOIDA semantics and do not
transfer**, which is a scope condition with a mechanism, and worth more than the
replication would have been.

Consequence for the product: **GRIE must not ship against NYC data with its
NOIDA weights.**

## Branches

| Branch | Contains |
|---|---|
| `main` | The complete previous system — NOIDA Authority — and all its research |
| `archive/noida-model` | Identical snapshot, so the NOIDA domain model stays recoverable and citable |
| `rebuild/nyc-311` | This rebuild |

The NOIDA work was archived, never deleted and never commented out. Half-migrated
domain models are where the next six weeks of bugs come from.

## Attribution

Data: **NYC Open Data, 311 Service Requests** (`erm2-nwe9`), used under its
published terms with attribution. Image dataset for Layer 4: Urban Civic Issues
(QR4Change), CC BY 4.0. Cross-domain arms: BPI Challenge 2015 and 2018
(4TU.ResearchData, CC-BY).
