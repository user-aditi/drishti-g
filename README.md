# DRISHTI-G

A governance platform for **NOIDA Authority**, built around two engines:

- **GCCE** — *Governance Capability Coordination Engine.* Routes every complaint to the officer actually responsible for that sector, records why, and escalates it up the chain when a deadline is missed.
- **GRIE** — *Governance Risk Intelligence Engine.* Scores sectors, circles, zones, departments, contractors and projects 0–100, and always shows **why** — per-factor contributions that add up to the score, never a black-box number.

> **A note on the city.** Noida has no municipal corporation. It is administered by **NOIDA — the New Okhla Industrial Development Authority**, a UP state development authority, and its geography is *sectors* grouped into *work circles* grouped into *zones*. The data model follows the real thing.

**Status: the full chain of command works end to end**, from a citizen filing in Hinglish to a Beldar submitting a photograph to an Executive Engineer signing it off.

---

## Quick start

Docker Desktop must be running.

```bash
cp .env.example .env
```

```bash
docker compose up -d postgres
```

```bash
cd backend && npm install && npm run prisma:migrate && npm run seed
```

The seed writes the demo authority against the legacy zone/circle/sector tables.
Three scripts then move it onto the org tree the application actually reads, and
they must run in this order — the roles script refuses to retire field-worker
postings until crew records exist to replace them:

```bash
cd backend && npm run org:build && npm run migrate:crew && npm run org:roles
```

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| Health check | http://localhost:4000/api/v1/health |

### Demo accounts

All use the password `drishti123`. The login screen has one-click buttons.

| Email | Rank | What to look at |
|---|---|---|
| `admin@drishti.gov.in` | Super Admin | Org chart, departments, people, audit trail |
| `ceo@noidaauthority.in` | CEO | Authority-wide oversight |
| `gm.civil@noidaauthority.in` | General Manager | One department, all zones |
| `ee.wc5.civil@noidaauthority.in` | Executive Engineer | Work Circle 5 — escalations land here |
| `je.s5.civil@noidaauthority.in` | Junior Engineer | Sector 5 desk — allot work to your crew |
| `worker1.s5.civil@noidaauthority.in` | Beldar | The field worker's phone view |
| `citizen@example.com` | Citizen | Report an issue and track it |

### Filling it with traffic

The seed is 938 hand-written rows — enough to click through, not enough to judge
a screen by or to train anything on. The simulator drives the **real HTTP API**
with months of plausible municipal work, so GCCE genuinely routes it, the
scheduler genuinely escalates it and GRIE genuinely scores it:

```bash
cd backend && npm run dev:sim
```

```bash
cd backend && npm run sim:run -- --reset --days 180 --per-day 30
```

`dev:sim` is the ordinary dev server with the per-IP rate limit on the public
crew surface turned off — every simulated crew member shares one address, so the
limiter would otherwise refuse most field submissions. Both that flag and the
timestamp rewriting are env-gated and refused when `NODE_ENV=production`.

Flags: `--days`, `--per-day`, `--breach-rate` (0.15), `--override-rate` (0.10),
`--citizens`, `--seed`, `--reset`. A run reproduces exactly with
`--reset --seed N`; without `--reset` the second run piles onto the first.

**This data is simulated.** It may train models and fill screens. It is not
evidence for anything — see `docs/pending-work.md` §7 for what is real in it
(every row's existence and content) and what is not (every timestamp, and the
whole population).

---

## The chain of command

```
                    CEO  ·  Super Admin              authority-wide
                          │
             General Manager / Chief Engineer        one department
                          │
        Superintending Engineer / Chief Sanitary Officer    zone
                          │
          Executive Engineer / Sanitary Officer      work circle
                          │
        Junior Engineer / Sanitary Inspector         sector   ← triage
                          │
      Safai Karamchari · Lineman · Beldar            sector   ← the work
```

Designations differ by department — a Junior Engineer in Civil is a **Sanitary Inspector** in Public Health — and the org chart shows each department's real titles.

### Geography

```
Zone I — Central Noida    Work Circles 1–2    Sectors 12, 15, 22, 18, 27, 29
Zone II — Expressway      Work Circles 3–4    Sectors 62, 63, 71, 128, 137, 168
Zone III — Old Noida      Work Circles 5–6    Sectors 1, 5, 8, 9, 10, 11
```

### The scaling primitive

Everything hangs off a **Posting** — one row joining *person × department × rank × jurisdiction*. Adding a department, a zone, or a whole tier of staff is data, not code. One person can hold several postings (an Executive Engineer covering a vacant neighbouring circle), and a transfer ends the old posting rather than editing it, so the record of who held which charge and when survives.

---

## The ten-minute demo

1. **Citizen** — sign in as `citizen@example.com` and report an issue. Try Hinglish: *"Gali ki batti kharab hai, poora andhera rehta hai."* Leave the category blank.

   GCCE shows its working: which keywords matched, which department owns it, which sector the coordinates fall in, the priority and why, and **which Junior Engineer it landed on**.

2. **Junior Engineer** — sign in as `je.s5.civil@noidaauthority.in`. The complaint is on their desk marked *needs a crew*. Click **Allot to crew**: only Beldars posted to Sector 5 appear, sorted by current workload, because the category calls for that trade.

3. **Field worker** — sign in as `worker1.s5.civil@noidaauthority.in`. Big buttons, plain language, a directions link. Try **Work finished** without a photo: it refuses. This app has no resolve, close or reassign — a worker genuinely cannot do those.

4. **Back to the JE** → **To inspect**. Accept the work, or send it back to the crew with a reason. Nothing counts as resolved until a human has looked at it.

5. **Executive Engineer** — sign in as `ee.wc5.civil@noidaauthority.in` → **Escalated to me**. Complaints that blew their deadline are now *their* problem, each with the reason and hours overdue. Only Circle Officer and above can close a complaint, so a JE cannot sign off their own section's work.

6. **Super Admin** — `admin@drishti.gov.in` → **Risk queue**, then *"Why was this flagged?"* on Sector 5. Every factor with its measurement, weight, contribution, and a total that reconciles. Then **Org chart** and **Map**.

7. **Decisions** → every judgement the engines made, with the corrections attached. This is the screen the autonomy gate is argued from, and the source of the labels the models train on.

8. **Autonomy gate** → what the system would do without a person, and why it will not. Each threshold shows the error tolerance it was held to and the error it actually achieved. Two of the three classes read *no threshold works*, which is the measured conclusion rather than a setting.

---

## Proving it still works

Three scripts, each meant to be re-run rather than run once.

```bash
cd backend && npm run accept          # drive the whole lifecycle end to end, 11 steps
cd frontend && npm run audit:pages    # open all 39 routes as all four roles, timed
cd backend && npm test                # 168 tests across 12 suites
```

`npm run accept` is the honest version of the acceptance checklist: a citizen
registers and files with a photograph, GCCE routes it and explains why, an
officer issues a crew code, someone with no account at all opens that code and
uploads proof, the automated checks score it, the citizen confirms, a second
complaint blows its deadline and climbs the chain on its own, GRIE rescores, and
the audit chain still verifies. It fails loudly and reports which step.

---

## Architecture

```
frontend/            Next.js 14 App Router + TypeScript + Tailwind 4 + Leaflet
  src/
    app/
      (auth)/        login, register — outside the app shell
      (citizen)/     dashboard, file a complaint, complaint detail, departments
      worker/        the field worker phone view
      officer/       the Section Officer desk, inspection queue, sector map
      admin/         oversight from Circle Officer up: dashboard, escalations,
                     complaints, risk queue, sector risk, map, org chart,
                     people, departments, audit trail
    components/
      ui/            cva primitives: button, card, badge, input, select, ...
      shared/        risk explanation and dial, timeline, complaint card,
                     status badges, rank-aware sidebar and topbar, map
    lib/             server api (forwards the cookie), browser api client,
                     auth guards, design tokens, formatters

research/            the interpretability experiment — see research/README.md
  drishti_research/  generator, models, tuning, diagnostics, experiments
  data/              model-spec.json, exported from the backend

backend/             Node 22 + TypeScript + Express + Prisma
  prisma/
    schema.prisma    18 models, 8 ranks, 3 geographic tiers
    seed.ts          the whole authority, with generated complaint history
  src/
    config/          env validation (fails fast on bad config)
    lib/             prisma, auth primitives, logger
    middleware/      authenticate, requireRank, zod validation, uploads, errors
    routes/          auth, complaints, officer, worker, risk, org, admin, notifications
    services/        hierarchy.ts, gcce.ts, escalation.ts, grie.ts, riskSignals.ts,
                     audit.ts, priority.ts, verification.ts
```

### One database, one job

**Postgres is the system of record**, and the only one. A Neo4j projection ran
alongside it for a while on the theory that "who covers this sector?" wanted a
traversal; nothing ever queried it, so it was removed. The org tree is a
recursive CTE, which is what it should be — see
[docs/real-world-readiness.md](docs/real-world-readiness.md) for the reasoning
and for the conditions under which a graph would earn its place back.

---

## How GCCE decides

`backend/src/services/gcce.ts`. Three questions in a fixed order, each recorded:

1. **Where does this belong?** Category from word-boundary keyword matching, seeded with Hinglish (`gaddha`, `batti`, `kachra`, `nali`, `machhar`). Sector from the nearest centroid, falling back to the citizen's registered sector. Categories belonging to a coming-soon department are excluded, so a complaint is never captured by a wing that cannot act on it.
2. **Who is accountable?** The **Section Officer** for that sector — never a worker directly, because triage is the JE's job. If that post is vacant it falls up to the Circle Officer rather than leaving the complaint unowned.
3. **What else must happen?** Notify the citizen and the officer, queue a GRIE re-score, project into the graph.

Deterministic by design: ties break on id, so the same complaint always routes the same way and an officer can always explain why it reached them.

### Escalation

`backend/src/services/escalation.ts`. A complaint past its deadline becomes the next officer's problem — JE → EE → SE → GM — each step notified and audited. The ladder stops at General Manager: routing routine potholes to the CEO would make the CEO's queue meaningless, which is how escalation dies in practice.

Delays widen at each step (0h, 48h, 120h): the first escalation is quick because the JE may simply have missed it; later ones are slower so senior queues stay readable.

## How GRIE scores

`grie.ts` holds the model, `riskSignals.ts` collects the inputs. The split keeps the maths testable without a database.

| Entity | Factors (weights sum to 1.0) |
|---|---|
| **Sector / Circle / Zone / Department** | missed deadlines (0.28), repeat complaints (0.27), **escalations (0.20)**, open load (0.15), resolution speed (0.10) |
| **Project** | budget overrun (0.30), schedule delay (0.25), inspection failures (0.25), linked complaints (0.20) |
| **Contractor** | average project risk (0.40), late delivery (0.30), inspection failures (0.20), blacklisting (0.10) |

Geographic scopes share one factor set — a circle is the same thing as a sector at a wider magnification — so their scores are directly comparable. Only the **load cap** changes with scope (`LOAD_CAP`): a sector is saturated at 25 open complaints, a zone is not.

Anything scoring **60+** raises a flag. An entity that recovers has its flag cleared automatically rather than leaving a stale warning. Scores are **append-only**, so history can be replayed.

### A note on the research design

The v1 scorer is a transparent weighted sum, and that is the point. The paper asks whether an interpretable score costs accuracy against a black box — the interpretable model is the **treatment**, not a placeholder. The comparison model is the *control*, built later with the experiment harness.

## The audit trail

Every entry stores a SHA-256 hash over its own content **plus the previous entry's hash**, written inside the same transaction as the action it records. Verify from **Audit trail → Verify chain**, or:

```bash
curl http://localhost:4000/api/v1/admin/audit/verify -H "Authorization: Bearer <token>"
```

---

## Departments

Three are live and staffed to sector level; five are listed with a roadmap note so nobody has to guess whether the authority handles it.

| Live | Coming soon |
|---|---|
| 🧹 Public Health (जन स्वास्थ्य) | 🚰 Water & Sewerage |
| 💡 Electrical & Mechanical (विद्युत एवं यांत्रिक) | 🌳 Horticulture |
| 🛣️ Civil Engineering (सिविल अभियंत्रण) | 📐 Planning & Architecture |
| | 📜 Land & Property |
| | 🚦 Traffic & Transport Cell |

The Super Admin can take one live from **Departments** — but the API refuses to activate a department with no Section Officer posted, because its complaints would route to nobody.

---

## Seed data

Deliberately uneven so the dashboards show something real. **Sector 5 (Harola)** — a dense older settlement in Work Circle 5 — is the problem area: a 28% resolution rate, 78% of complaints late. **Okhla Civil Works** is blacklisted and ran the **Harola Drainage Upgrade**, 45% over budget and 140 days late.

GRIE finds the whole cluster on its own, and the connection between them is the project's thesis: a bad sector, the circle containing it, the project there, and the contractor who ran it.

The generator uses a fixed PRNG seed, so every teammate's database is identical. How *fresh* a sector's complaints are follows from how well it is run — a sector that closes work keeps only recent complaints in hand, a neglected one accumulates a backlog.

---

## The four models, and which of them ship

Every model is trained in Python, exported as a JSON spec, and executed in
TypeScript. No Python in the request path, no second container, and no drift
between the model that was studied and the model that runs.

```bash
cd backend && npm run sim:run -- --reset --days 75 --per-day 28   # generate traffic
cd backend && npm run export:training       # complaint text with every label
cd backend && npm run export:eventlog       # the lifecycle as a process log
cd backend && npm run export:resolutions    # how long work actually took
```

```bash
cd research
python -m drishti_research.classifier   # W3.1 — complaint text
python -m drishti_research.predictor    # W3.2 — what happens next
python -m drishti_research.sla          # W3.3 — how long it will take
python -m drishti_research.conformal    # W4.1 — the gate's thresholds
```

| | Result | Shipped |
|---|---|---|
| Classifier | 10.8% against the keyword matcher's 82.4% | **No** — `CLASSIFIER_ENABLED = false` |
| Predictor | 0.815, against gradient boosting's 0.815 | Yes |
| SLA estimator | breach rate 60.2% → 10.4% | Yes |
| Autonomy gate | no threshold makes any action safe | Advisory only |

The classifier is switched off because it is worse than what it replaces, and
the corpus is the reason: 1,094 complaints share **23 distinct texts**. The gate
automates nothing because the calibration found no confidence level at which any
status transition can be taken unattended — every one of them is a claim
somebody should be willing to stand behind.

Both are recorded rather than hidden. Full working in `docs/pending-work.md`.

---

## What is next

1. **Email notifications** — already persisted first, so a sender only drains unsent rows
2. **A complaint corpus with real variety** — the blocker on W3.1, and on anything that reads complaint text. Twenty-three phrasings cannot train or evaluate a classifier, and generating more of them would only teach the generator
3. **An officer-facing re-route endpoint** — an officer who finds a drainage complaint that belongs to Electrical currently cannot say so; only the Super Admin console can reassign. It blocks W2.3's third feedback signal, and it needs a governance decision first: may a Junior Engineer hand work to a peer department, or only escalate upward?
4. **Duplicate detection** and the public transparency page
5. **For the paper** — replace the unverified calibration parameters with cited figures, and add bootstrap intervals on the skill gap (see `research/README.md`)
