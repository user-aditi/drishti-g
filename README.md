# DRISHTI-G

A governance platform for a municipal corporation, built around two engines:

- **GCCE** — *Governance Capability Coordination Engine.* Every state-changing action routes through it. It resolves who is responsible, triggers whatever else must happen, and logs the reasoning. Deterministic by design.
- **GRIE** — *Governance Risk Intelligence Engine.* Scores wards, contractors, and projects 0–100 from real signals, and always returns **why** — per-factor contributions, not a black-box number.

Current status: **Phase 1 complete.** Database schema, authentication, roles, and the GCCE/GRIE engines are implemented and tested. Complaint filing and the risk queue are the next modules.

---

## Quick start

Docker Desktop must be running first.

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
docker compose exec api alembic upgrade head
```

```bash
docker compose exec api python -m app.seed
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API docs (Swagger) | http://localhost:8000/docs |
| Health check | http://localhost:8000/api/v1/health |
| Neo4j Browser | http://localhost:7474 |

### Demo accounts

All use the password `drishti123`.

| Email | Role |
|---|---|
| `admin@drishti.gov.in` | Administrator |
| `elec.ward1@drishti.gov.in` | Field Official — Electrical, Ward 1 |
| `citizen@example.com` | Citizen — Ward 1 |

---

## Running the backend without Docker

Postgres and Neo4j still need to be up (`docker compose up -d postgres neo4j`).

```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
```

Then set `POSTGRES_HOST=localhost` and `NEO4J_URI=bolt://localhost:7687` before running `alembic`, `uvicorn`, or `python -m app.seed`.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest
```

69 tests, no external services needed — they run against in-memory SQLite. Migrations are verified separately against real Postgres via `alembic upgrade head`.

---

## Project layout

```
backend/
  app/
    core/        config, password hashing, JWT
    db/          SQLAlchemy session, Neo4j driver, dialect-aware column types
    models/      the domain: users, org, complaints, works, risk, audit
    schemas/     pydantic request/response models
    services/    gcce.py, grie.py, audit.py, graph_sync.py
    api/v1/      auth, users, org, system routes
  alembic/       migrations
  tests/         pytest suite
frontend/
  src/
    context/     AuthContext — session restore, login, role checks
    components/  Layout (role-aware nav), ProtectedRoute
    pages/       Login, Register, Dashboard
    lib/         api client with token refresh, shared types
docs/
```

---

## How the two databases divide the work

**Postgres is the system of record.** Every row lives there, and it is the only source that must be correct.

**Neo4j is a projection.** It exists so "who is connected to what" is a traversal rather than a recursive join — which is what GCCE needs for routing and GRIE needs to propagate risk from a project to its contractor and ward. Every graph write is a `MERGE`, so the projection can be rebuilt from Postgres at any time:

```bash
curl -X POST http://localhost:8000/api/v1/graph/sync -H "Authorization: Bearer <admin-token>"
```

If the graph is ever unreachable, the API still boots and every non-graph endpoint keeps working; `/health` reports the graph as down.

---

## The audit trail

Every audit row stores a SHA-256 hash over its own content **plus the previous row's hash**. Editing or deleting any historical row breaks every hash after it. This is the guarantee the project plan wanted from blockchain, without the ledger:

```bash
curl http://localhost:8000/api/v1/audit/verify -H "Authorization: Bearer <admin-token>"
```

Returns `{"valid": true, "checked": N, "head": "..."}`, or the id of the first row that fails to verify. `tests/test_audit.py` proves this by actually tampering with rows.

---

## Roles

| Role | Created by | Can do |
|---|---|---|
| `citizen` | Public registration | File and track their own complaints |
| `field_official` | Admin only | See assigned tasks, submit evidence |
| `admin` | Admin only (first one via seed) | Everything, including user management and the risk queue |

Public registration **always** produces a citizen — passing `"role": "admin"` to `/auth/register` is ignored, and there is a test for that. Officials require both a ward and a department, because GCCE assigns work by that pair and an official missing either would never receive a task.

---

## Where each engine lives

| Concern | File |
|---|---|
| Routing, assignment, priority, downstream triggers | `backend/app/services/gcce.py` |
| Risk factors, weights, normalisation, bands | `backend/app/services/grie.py` |
| Hash chain | `backend/app/services/audit.py` |
| Graph projection | `backend/app/services/graph_sync.py` |

### A note on GRIE's design

The v1 scorer is a transparent weighted sum, and that is deliberate. The paper asks whether an interpretable risk score costs accuracy against a black box — so the interpretable model is the **treatment**, not a placeholder. The scikit-learn comparison model is the *control* and gets built later, alongside the experiment harness.

The weights in `grie.py` are the tunable part. They sum to 1.0 per entity type, and a test enforces that — if they drift, a maximum-risk entity stops scoring 100 and the risk bands stop meaning what they claim.

---

## Next up

1. Complaint filing (text + photo + location) and the citizen tracking view
2. Field-official task inbox with evidence upload
3. GRIE signal collection from live system data, plus the supervisor review queue
4. Notifications (email), then the Leaflet map view
5. Hindi/Hinglish auto-categorisation (MuRIL / IndicBERT) — GCCE's keyword matcher is the fallback it will sit in front of
