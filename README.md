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
docker compose up -d postgres neo4j
```

```bash
cd backend && npm install && npm run prisma:migrate && npm run seed
```

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:4000/api/v1 |
| Health check | http://localhost:4000/api/v1/health |
| Neo4j Browser | http://localhost:7474 |

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

---

## Architecture

```
frontend/            React 18 + TypeScript + Tailwind + Vite + Leaflet
  src/
    components/      AppShell (rank-aware nav), RiskExplanation, Timeline, ui primitives
    context/         AuthContext — session restore, login, rank checks
    lib/             api client (single-flight refresh), types, formatters
    pages/           Login, Register, CitizenHome, NewComplaint, ComplaintDetail,
                     OfficerDesk, WorkerJobs, Oversight, Escalations, RiskQueue,
                     SectorRisk, ComplaintMap, OrgChart, Departments, People, AuditTrail

backend/             Node 22 + TypeScript + Express + Prisma
  prisma/
    schema.prisma    18 models, 8 ranks, 3 geographic tiers
    seed.ts          the whole authority, with generated complaint history
  src/
    config/          env validation (fails fast on bad config)
    lib/             prisma, neo4j, auth primitives, logger
    middleware/      authenticate, requireRank, zod validation, uploads, errors
    routes/          auth, complaints, officer, worker, risk, org, admin, notifications
    services/        hierarchy.ts, gcce.ts, escalation.ts, grie.ts, riskSignals.ts,
                     audit.ts, graphSync.ts
```

### Two databases, two jobs

**Postgres is the system of record.** **Neo4j is a projection** — it exists so "who covers this sector?" is a one-hop traversal rather than a join. Every graph write is a `MERGE`, so it rebuilds from Postgres at any time:

```bash
curl -X POST http://localhost:4000/api/v1/graph/sync -H "Authorization: Bearer <token>"
```

If the graph is unreachable the API still boots and `/health` reports it as down.

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

## What is next

1. **Email notifications** — already persisted first, so a sender only drains unsent rows
2. **Hindi/Hinglish auto-categorisation** (MuRIL / IndicBERT) — GCCE's keyword matcher is the fallback it will sit in front of
3. **The research harness** — dataset generator, the scikit-learn control model, the experiment runner
4. **Scheduled escalation** — the sweep exists and is exposed as an endpoint; it needs a cron
5. **Duplicate detection** and the public transparency page
