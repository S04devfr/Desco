"""
crm.services.stage_service
~~~~~~~~~~~~~~~~~~~~~~~~~~
All business logic for pipeline stage management (pure stdlib / sqlite3).
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from decimal import Decimal
from typing import Optional

from crm.exceptions import (
    NoFallbackStageError,
    StageHasActiveDealsError,
    StageNameConflictError,
    StageNotFoundError,
)
from crm.schemas import (
    PipelineSnapshot,
    StageAggregation,
    StageCreateRequest,
    StageResponse,
    StageUpdateRequest,
)

logger = logging.getLogger(__name__)

# ── Default stage definitions ─────────────────────────────────────────────────

DEFAULT_STAGES: list[dict] = [
    {"name": "ПЕРВИЧНЫЙ КОНТАКТ", "order_index": 0},
    {"name": "ПЕРЕГОВОРЫ",        "order_index": 1},
    {"name": "ПРИНИМАЮТ РЕШЕНИЕ", "order_index": 2},
]


def _row_to_stage(row: sqlite3.Row) -> StageResponse:
    return StageResponse(
        id=row["id"],
        name=row["name"],
        order_index=row["order_index"],
        is_active=bool(row["is_active"]),
        created_at=datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")),
    )


def seed_default_stages(conn: sqlite3.Connection) -> list[StageResponse]:
    """Insert the three canonical CRM stages idempotently."""
    for entry in DEFAULT_STAGES:
        exists = conn.execute(
            "SELECT 1 FROM stages WHERE name = ?", (entry["name"],)
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO stages (name, order_index) VALUES (?, ?)",
                (entry["name"], entry["order_index"]),
            )
            logger.info("Seeded stage %r.", entry["name"])
    conn.commit()

    rows = conn.execute(
        "SELECT * FROM stages WHERE is_active=1 ORDER BY order_index, id"
    ).fetchall()
    return [_row_to_stage(r) for r in rows]


# ── Service ───────────────────────────────────────────────────────────────────

class StageService:

    # helpers -----------------------------------------------------------------

    @staticmethod
    def _get_or_raise(conn: sqlite3.Connection, stage_id: int) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM stages WHERE id=? AND is_active=1", (stage_id,)
        ).fetchone()
        if row is None:
            raise StageNotFoundError(stage_id)
        return row

    @staticmethod
    def _name_exists(conn: sqlite3.Connection, name: str, exclude_id: Optional[int] = None) -> bool:
        if exclude_id is None:
            row = conn.execute(
                "SELECT 1 FROM stages WHERE name=? AND is_active=1", (name,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT 1 FROM stages WHERE name=? AND is_active=1 AND id!=?",
                (name, exclude_id),
            ).fetchone()
        return row is not None

    @staticmethod
    def _count_deals(conn: sqlite3.Connection, stage_id: int) -> int:
        row = conn.execute(
            "SELECT COUNT(*) FROM deals WHERE stage_id=?", (stage_id,)
        ).fetchone()
        return row[0] if row else 0

    @staticmethod
    def _fallback_stage(conn: sqlite3.Connection, exclude_id: int) -> Optional[sqlite3.Row]:
        return conn.execute(
            "SELECT * FROM stages WHERE is_active=1 AND id!=? ORDER BY order_index, id LIMIT 1",
            (exclude_id,),
        ).fetchone()

    # CRUD --------------------------------------------------------------------

    def create(self, conn: sqlite3.Connection, payload: StageCreateRequest) -> StageResponse:
        logger.debug("Creating stage name=%r.", payload.name)
        if self._name_exists(conn, payload.name):
            raise StageNameConflictError(payload.name)
        cursor = conn.execute(
            "INSERT INTO stages (name, order_index) VALUES (?, ?)",
            (payload.name, payload.order_index),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM stages WHERE id=?", (cursor.lastrowid,)).fetchone()
        logger.info("Stage created: id=%d name=%r.", row["id"], row["name"])
        return _row_to_stage(row)

    def get(self, conn: sqlite3.Connection, stage_id: int) -> StageResponse:
        return _row_to_stage(self._get_or_raise(conn, stage_id))

    def list_all(self, conn: sqlite3.Connection) -> list[StageResponse]:
        rows = conn.execute(
            "SELECT * FROM stages WHERE is_active=1 ORDER BY order_index, id"
        ).fetchall()
        return [_row_to_stage(r) for r in rows]

    def update(
        self, conn: sqlite3.Connection, stage_id: int, payload: StageUpdateRequest
    ) -> StageResponse:
        logger.debug("Updating stage id=%d.", stage_id)
        row = self._get_or_raise(conn, stage_id)

        new_name        = payload.name        if payload.name        is not None else row["name"]
        new_order_index = payload.order_index if payload.order_index is not None else row["order_index"]

        if payload.name is not None and self._name_exists(conn, payload.name, exclude_id=stage_id):
            raise StageNameConflictError(payload.name)

        conn.execute(
            "UPDATE stages SET name=?, order_index=? WHERE id=?",
            (new_name, new_order_index, stage_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM stages WHERE id=?", (stage_id,)).fetchone()
        logger.info("Stage updated: id=%d.", stage_id)
        return _row_to_stage(updated)

    def delete(
        self,
        conn: sqlite3.Connection,
        stage_id: int,
        *,
        migrate: bool = False,
    ) -> dict:
        """Soft-delete a stage.

        If ``migrate=False`` and the stage owns deals → raises StageHasActiveDealsError.
        If ``migrate=True``  and the stage owns deals → reassigns to lowest-order alternative.
        If ``migrate=True``  and no alternative exists → raises NoFallbackStageError.
        """
        logger.debug("Deleting stage id=%d migrate=%s.", stage_id, migrate)
        self._get_or_raise(conn, stage_id)  # raises StageNotFoundError if missing
        deal_count = self._count_deals(conn, stage_id)

        migrated_count = 0
        fallback_id: Optional[int] = None

        if deal_count > 0:
            if not migrate:
                raise StageHasActiveDealsError(stage_id, deal_count)
            fallback_row = self._fallback_stage(conn, exclude_id=stage_id)
            if fallback_row is None:
                raise NoFallbackStageError(stage_id)
            conn.execute(
                "UPDATE deals SET stage_id=? WHERE stage_id=?",
                (fallback_row["id"], stage_id),
            )
            migrated_count = deal_count
            fallback_id = fallback_row["id"]
            logger.info("Migrated %d deal(s) → stage id=%d.", migrated_count, fallback_id)

        conn.execute("UPDATE stages SET is_active=0 WHERE id=?", (stage_id,))
        conn.commit()
        logger.info("Stage id=%d soft-deleted.", stage_id)
        return {
            "deleted_stage_id":  stage_id,
            "migrated_deal_count": migrated_count,
            "fallback_stage_id": fallback_id,
        }

    # Aggregation -------------------------------------------------------------

    def pipeline_snapshot(self, conn: sqlite3.Connection) -> PipelineSnapshot:
        """Single SQL query → per-stage deal count + total amount."""
        rows = conn.execute("""
            SELECT s.id, s.name,
                   COUNT(d.id)          AS deal_count,
                   COALESCE(SUM(d.amount_uzs), 0) AS total_amount
            FROM   stages s
            LEFT JOIN deals d ON d.stage_id = s.id
            WHERE  s.is_active = 1
            GROUP  BY s.id, s.name
            ORDER  BY s.order_index, s.id
        """).fetchall()

        aggregations = [
            StageAggregation(
                stage_id=r["id"],
                stage_name=r["name"],
                deal_count=r["deal_count"],
                total_amount_uzs=Decimal(str(r["total_amount"])),
            )
            for r in rows
        ]
        grand_deals  = sum(a.deal_count        for a in aggregations)
        grand_amount = sum(a.total_amount_uzs  for a in aggregations)
        return PipelineSnapshot(
            stages=aggregations,
            grand_total_deals=grand_deals,
            grand_total_amount_uzs=grand_amount,
        )
