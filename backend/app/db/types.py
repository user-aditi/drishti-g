"""Column types that adapt to the active dialect.

Postgres gets its native types; SQLite gets a workable equivalent so the test
suite can run in memory without a live database. The Postgres DDL is unchanged,
so migrations are unaffected.
"""
from sqlalchemy import JSON, BigInteger, Integer
from sqlalchemy.dialects.postgresql import JSONB

# JSONB on Postgres (indexable, binary), plain JSON on SQLite.
JSONColumn = JSON().with_variant(JSONB(), "postgresql")

# SQLite only auto-increments INTEGER PRIMARY KEY, never BIGINT.
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")
