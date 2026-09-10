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

| Layer | Adds | Measured against the baseline by |
|---|---|---|
| **0** | The replica: intake, routing, agency queues, status, geography | — it *is* the baseline |
| 1 | Officer identity, work orders | Does named accountability change resolution time? |
| 2 | Escalation on SLA breach | Do our escalations coincide with what NYC actually closed late? |
| 3 | GCCE routing, GRIE risk radar | Routing accuracy against real agency assignment; do high-scored boards fail next month? |
| 4 | Photo verification | Scoped to potholes and garbage, the only categories with real imagery |

Only Layer 0 is built. Everything above it is specified and not yet written.

## Quick start

```bash
docker compose up --build
```

That brings up Postgres, migrates it, seeds the reference data, and starts the
API on `:4000` and the web app on `:3000`. It does **not** import the corpus —
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

The corpus is real historical data ending 2025-12-31. Ask `Date.now()` whether an
imported request is overdue and the answer is yes, for all 355,430 of them —
every queue sorts identically, every breach figure reads 100%, and nothing
throws. It looks exactly like a working feature.

So the system stands at a configured `SYSTEM_REFERENCE_DATE`, defaulting to the
last request in the corpus, and *nothing* computes overdue from wall-clock time.
The dates are never shifted to look recent: doing so would destroy real
seasonality, and garbage complaints genuinely spike in summer.

The server prints the reference date at boot, and `/api/v1/health` reports it.

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

## Proving it still works

```bash
cd backend && npm test
```

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
