"""FastAPI application entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, org, system, users
from app.core.config import settings
from app.db.neo4j import close_driver, init_constraints

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Neo4j being unreachable must not stop the API from booting - Postgres
    # still serves every endpoint that does not touch the graph, and /health
    # will report the graph as down.
    try:
        init_constraints()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Neo4j constraints could not be applied at startup: %s", exc)
    yield
    close_driver()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Governance platform coordinating municipal complaints through GCCE and "
        "scoring risk explainably through GRIE."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = settings.API_V1_PREFIX
app.include_router(system.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(users.router, prefix=api_prefix)
app.include_router(org.router, prefix=api_prefix)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": settings.PROJECT_NAME,
        "version": "0.1.0",
        "docs": "/docs",
        "health": f"{api_prefix}/health",
    }
