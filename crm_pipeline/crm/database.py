"""
crm.database
~~~~~~~~~~~~
SQLite3-backed persistence layer (pure stdlib).

* Connection factory with foreign-key enforcement enabled.
* Schema creation (idempotent CREATE TABLE IF NOT EXISTS).
* Thread-safe connection helper.
"""
from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

logger = logging.getLogger(__name__)

# ── Schema DDL ────────────────────────────────────────────────────────────────

_DDL = """
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS stages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE CHECK(length(name) <= 120),
    order_index INTEGER NOT NULL DEFAULT 0 CHECK(order_index >= 0),
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL CHECK(length(name) <= 240),
    amount_uzs  REAL    NOT NULL DEFAULT 0.0 CHECK(amount_uzs >= 0),
    stage_id    INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
"""


def _connect(db_path: str = ":memory:") -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    """Idempotent: creates tables if they don't already exist."""
    conn.executescript(_DDL)
    conn.commit()
    logger.info("Schema ensured.")


@contextmanager
def transaction(conn: sqlite3.Connection) -> Generator[sqlite3.Connection, None, None]:
    """Yield the connection; commit on success, rollback on any exception."""
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
