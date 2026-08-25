# DRISHTI-G

A governance platform for a municipal corporation, built around two engines:

- **GCCE** — *Governance Capability Coordination Engine.* Every state-changing action routes through it. It decides who is responsible, triggers whatever else must happen, and records its reasoning. Deterministic by design.
- **GRIE** — *Governance Risk Intelligence Engine.* Scores wards, contractors and projects 0–100 from real signals, and always shows **why** — per-factor contributions that add up to the score, never a black-box number.

**Status: the complaint lifecycle works end to end.** A citizen files an issue, GCCE routes it, a field official works it and submits evidence, a supervisor signs it off, and GRIE re-scores the ward from the result.

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

All use the password `drishti123`. The login screen has one-click buttons for these.

| Email | Role | What to look at |
|---|---|---|
| `admin@drishti.gov.in` | Supervisor | Dashboard, risk queue with full reasoning, audit trail |
| `swm.ward5@drishti.gov.in` | Field Official | Task inbox for the deliberately-overloaded ward |
| `citizen@example.com` | Citizen | File a complaint and watch GCCE route it live |

---

## The five-minute demo

1. **Sign in as the citizen.** File a complaint — try writing it in Hinglish, e.g. *"Gali ki batti kharab hai, poora andhera rehta hai."* Leave the category blank.
2. **Watch GCCE work.** The confirmation screen shows exactly what it decided and why: which category it matched and on how many keywords, which department owns it, which ward the coordinates fall in, what priority it assigned and why, and which official got the task.
3. **Sign in as `elec.ward1@drishti.gov.in`.** The complaint is already in their inbox, sorted by deadline. Start work, then resolve it with a photo — the API refuses to accept a resolution without evidence.
4. **Sign in as the supervisor.** Open the **Risk queue**, and click *"Why was this flagged?"* on Ward 5. Every factor is listed with its raw measurement, how it was scaled, its weight, and its contribution — and the contributions reconcile to the score.
5. **Open the Audit trail** and click *Verify chain*. Every entry carries a fingerprint of the one before it.

---

## Architecture

```
frontend/            React 18 + TypeScript + Tailwind + Vite
  src/
    components/      AppShell, RiskExplanation, Timeline, ComplaintCard, ui primitives
    context/         AuthContext — session restore, login, role checks
    lib/             api client (single-flight token refresh), types, formatters
    pages/           Login, Register, CitizenHome, NewComplaint, ComplaintDetail,
                     TaskInbox, AdminDashboard, RiskQueue, WardRisk, AllComplaints,
                     Users, AuditTrail

backend/             Node 22 + TypeScript + Express + Prisma
  prisma/
    schema.prisma    13 models
    seed.ts          demo city with generated history
  src/
    config/          env validation (fails fast on bad config)
    lib/             prisma client, neo4j driver, auth primitives, logger
    middleware/      authenticate, requireRole, zod validation, uploads, errors
    routes/          auth, complaints, tasks, risk, org, notifications, admin, system
    services/        gcce.ts, grie.ts, riskSignals.ts, audit.ts, graphSync.ts
```

### Two databases, two jobs

**Postgres is the system of record.** Every row lives there and it is the only source that must be correct.

**Neo4j is a projection.** It exists so "who is connected to what" is a traversal rather than a join — what GCCE needs for routing and GRIE needs to propagate risk from a project to its contractor and ward. Every graph write is a `MERGE`, so it can be rebuilt at any time:

```bash
curl -X POST http://localhost:4000/api/v1/graph/sync -H "Authorization: Bearer <admin-token>"
```

If the graph is unreachable the API still boots, every non-graph endpoint keeps working, and `/health` reports it as down.

---

## How GCCE decides

`backend/src/services/gcce.ts`. Three questions in a fixed order, each one recorded:

1. **Where does this belong?** Category from keyword matching over the complaint text — word-boundary aware, and seeded with Hinglish terms (`gaddha`, `batti`, `kachra`, `nali`, `pani`, `machhar`) because that is how complaints actually arrive. Ward from the nearest centroid to the citizen's coordinates, falling back to their registered ward.
2. **Who is accountable?** The least-loaded active official serving that department *and* ward, counting open assignments so work spreads. Ties break on id, which is what makes routing reproducible. Priority escalates when a ward already has 30+ open complaints.
3. **What else must happen?** Notify the citizen and the assignee, queue a GRIE re-score for the ward, project the complaint into the graph.

It is deliberately deterministic. The plan rules out autonomous multi-step agents, and coordination is exactly where unpredictability would cost most — the same complaint must always route the same way, and a supervisor must be able to explain why it did.

Status transitions are a state machine in `ALLOWED_TRANSITIONS`, checked server-side. A task cannot jump from assigned straight to closed, and resolving requires an evidence photo.

## How GRIE scores

`backend/src/services/grie.ts` holds the model; `riskSignals.ts` collects the inputs from live data. The split is deliberate — the scoring maths is testable without a database.

| Entity | Factors (weights sum to 1.0) |
|---|---|
| **Ward** | repeat complaints (0.35), missed deadlines (0.30), open load (0.20), resolution speed (0.15) |
| **Project** | budget overrun (0.30), schedule delay (0.25), inspection failures (0.25), linked complaints (0.20) |
| **Contractor** | average project risk (0.40), late delivery (0.30), inspection failures (0.20), blacklisting (0.10) |

Anything scoring **60 or above** raises a flag for human review. An entity that recovers has its flag closed automatically rather than leaving a stale warning in the queue.

Scores are **append-only** — recomputing writes a new row, so history is inspectable and the paper's experiments can replay it.

### A note on the research design

The v1 scorer is a transparent weighted sum, and that is the point. The paper asks whether an interpretable risk score costs accuracy against a black box — so the interpretable model is the **treatment**, not a placeholder. The comparison model is the *control* and gets built later, alongside the experiment harness.

The weights are the tunable part. They sum to 1.0 per entity type; if they drift, a maximum-risk entity stops scoring 100 and the bands stop meaning what they claim.

## The audit trail

`backend/src/services/audit.ts`. Every entry stores a SHA-256 hash over its own canonical content **plus the previous entry's hash**. Editing or deleting any historical row breaks every hash after it.

Audit writes happen inside the same transaction as the action they record — so an action and its audit entry either both land or neither does, and reading the head hash inside that transaction keeps the chain linear under concurrent writes.

Verify from the UI (**Audit trail → Verify chain**) or directly:

```bash
curl http://localhost:4000/api/v1/admin/audit/verify -H "Authorization: Bearer <admin-token>"
```

This is the guarantee the project plan wanted from blockchain, without the ledger.

---

## Roles

| Role | Created by | Can do |
|---|---|---|
| `CITIZEN` | Public registration | File complaints, track them, leave feedback |
| `FIELD_OFFICIAL` | Supervisor only | Work assigned tasks, submit evidence |
| `ADMIN` | Supervisor only (first via seed) | Everything, plus the risk queue and audit trail |

Public registration **always** produces a citizen — passing `"role": "ADMIN"` to `/auth/register` is ignored. Officials require both a ward and a department, because GCCE assigns by that pair and an official missing either would never receive a task.

---

## Seed data

The seeded city is deliberately uneven so the dashboards show something real. **Ward 5 (Old City)** is the problem ward: 26 complaints, a 30% resolution rate and a 70% late rate. **Satpura Civil Works** is blacklisted and runs the **Old City Drainage Upgrade**, which is 45% over budget and 140 days late.

GRIE finds all three on its own, from the data alone:

```
SEVERE   89.08  Satpura Civil Works        — their projects average a risk score of 85/100
SEVERE   85.19  Old City Drainage Upgrade  — spending is 45% over the allocated budget
HIGH     62.33  Ward 5 — Old City          — 92% of complaints missed their resolution deadline
```

The generator uses a fixed PRNG seed, so every teammate's database looks identical.

---

## What is next

1. **Leaflet map view** — the coordinates and ward centroids are already stored; this is a rendering layer
2. **Email notifications** — notifications are persisted first, so a sender only needs to drain unsent rows
3. **Hindi/Hinglish auto-categorisation** (MuRIL / IndicBERT) — GCCE's keyword matcher is the fallback it will sit in front of
4. **The research harness** — dataset generator, the scikit-learn control model, and the experiment runner
5. **Duplicate detection** and the public transparency page
