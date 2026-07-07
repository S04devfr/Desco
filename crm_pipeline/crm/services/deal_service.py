"""
crm.services.deal_service
~~~~~~~~~~~~~~~~~~~~~~~~~
Business logic for CRM deal / lead management (pure stdlib / sqlite3).

State-machine invariant: a deal's stage_id may only ever reference an
*active* stage — enforced on every write path.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from decimal import Decimal
from typing import Optional

from crm.exceptions import (
    DealNotFoundError,
    InvalidStageTransitionError,
)
from crm.schemas import (
    DealCreateRequest,
    DealMoveRequest,
    DealResponse,
    DealUpdateRequest,
)

logger = logging.getLogger(__name__)


def _row_to_deal(row: sqlite3.Row) -> DealResponse:
    return DealResponse(
        id=row["id"],
        name=row["name"],
        amount_uzs=Decimal(str(row["amount_uzs"])),
        stage_id=row["stage_id"],
        created_at=datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")),
    )


class DealService:

    # helpers -----------------------------------------------------------------

    @staticmethod
    def _get_or_raise(conn: sqlite3.Connection, deal_id: int) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM deals WHERE id=?", (deal_id,)).fetchone()
        if row is None:
            raise DealNotFoundError(deal_id)
        return row

    @staticmethod
    def _assert_stage_active(conn: sqlite3.Connection, stage_id: int) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM stages WHERE id=? AND is_active=1", (stage_id,)
        ).fetchone()
        if row is None:
            raise InvalidStageTransitionError(stage_id)
        return row

    # CRUD --------------------------------------------------------------------

    def create(self, conn: sqlite3.Connection, payload: DealCreateRequest) -> DealResponse:
        logger.debug("Creating deal name=%r stage_id=%d.", payload.name, payload.stage_id)
        self._assert_stage_active(conn, payload.stage_id)
        cursor = conn.execute(
            "INSERT INTO deals (name, amount_uzs, stage_id) VALUES (?, ?, ?)",
            (payload.name, float(payload.amount_uzs), payload.stage_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM deals WHERE id=?", (cursor.lastrowid,)).fetchone()
        logger.info("Deal created: id=%d.", row["id"])
        return _row_to_deal(row)

    def get(self, conn: sqlite3.Connection, deal_id: int) -> DealResponse:
        return _row_to_deal(self._get_or_raise(conn, deal_id))

    def list_all(
        self, conn: sqlite3.Connection, *, stage_id: Optional[int] = None
    ) -> list[DealResponse]:
        if stage_id is not None:
            rows = conn.execute(
                "SELECT * FROM deals WHERE stage_id=? ORDER BY created_at DESC, id DESC", (stage_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM deals ORDER BY created_at DESC, id DESC"
            ).fetchall()
        return [_row_to_deal(r) for r in rows]

    def update(
        self, conn: sqlite3.Connection, deal_id: int, payload: DealUpdateRequest
    ) -> DealResponse:
        logger.debug("Updating deal id=%d.", deal_id)
        row = self._get_or_raise(conn, deal_id)

        new_name       = payload.name       if payload.name       is not None else row["name"]
        new_amount     = float(payload.amount_uzs) if payload.amount_uzs is not None else row["amount_uzs"]
        new_stage_id   = payload.stage_id   if payload.stage_id   is not None else row["stage_id"]

        if payload.stage_id is not None:
            self._assert_stage_active(conn, payload.stage_id)

        conn.execute(
            "UPDATE deals SET name=?, amount_uzs=?, stage_id=? WHERE id=?",
            (new_name, new_amount, new_stage_id, deal_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM deals WHERE id=?", (deal_id,)).fetchone()
        logger.info("Deal updated: id=%d.", deal_id)
        return _row_to_deal(updated)

    def move(
        self, conn: sqlite3.Connection, deal_id: int, payload: DealMoveRequest
    ) -> DealResponse:
        """Dedicated state-machine transition."""
        logger.debug("Moving deal id=%d → stage id=%d.", deal_id, payload.target_stage_id)
        self._get_or_raise(conn, deal_id)
        self._assert_stage_active(conn, payload.target_stage_id)
        conn.execute(
            "UPDATE deals SET stage_id=? WHERE id=?",
            (payload.target_stage_id, deal_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM deals WHERE id=?", (deal_id,)).fetchone()
        logger.info("Deal id=%d moved → stage id=%d.", deal_id, payload.target_stage_id)
        return _row_to_deal(row)

    def delete(self, conn: sqlite3.Connection, deal_id: int) -> dict:
        self._get_or_raise(conn, deal_id)
        conn.execute("DELETE FROM deals WHERE id=?", (deal_id,))
        conn.commit()
        logger.info("Deal id=%d deleted.", deal_id)
        return {"deleted_deal_id": deal_id}
