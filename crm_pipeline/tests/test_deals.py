"""
tests/test_deals.py  —  DealService comprehensive unit tests (stdlib unittest)
"""
from __future__ import annotations
import sys
sys.path.insert(0, "/tmp/crm_pipeline")

import unittest
from decimal import Decimal
from crm.database import _connect, create_schema
from crm.exceptions import DealNotFoundError, InvalidStageTransitionError, StageHasActiveDealsError
from crm.schemas import (
    StageUpdateRequest,
    DealCreateRequest, DealUpdateRequest, DealMoveRequest, StageCreateRequest
)
from crm.services.deal_service import DealService
from crm.services.stage_service import StageService


def fresh_db():
    conn = _connect(":memory:")
    create_schema(conn)
    return conn


class TestDealCreate(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = DealService()
        self.ssvc  = StageService()
        self.stage = self.ssvc.create(self.conn, StageCreateRequest(name="Stage A"))

    def test_creates_with_valid_stage(self):
        r = self.svc.create(self.conn, DealCreateRequest(
            name="Deal 1", stage_id=self.stage.id, amount_uzs=Decimal("5_000_000")
        ))
        self.assertGreater(r.id, 0)
        self.assertEqual(r.name, "Deal 1")
        self.assertEqual(r.amount_uzs, Decimal("5_000_000"))
        self.assertEqual(r.stage_id, self.stage.id)
        self.assertIsNotNone(r.created_at)

    def test_creates_with_zero_amount(self):
        r = self.svc.create(self.conn, DealCreateRequest(
            name="Free", stage_id=self.stage.id, amount_uzs=Decimal("0")
        ))
        self.assertEqual(r.amount_uzs, Decimal("0"))

    def test_create_nonexistent_stage_raises(self):
        with self.assertRaises(InvalidStageTransitionError) as ctx:
            self.svc.create(self.conn, DealCreateRequest(name="Orphan", stage_id=9999))
        self.assertEqual(ctx.exception.code, "invalid_stage_transition")
        self.assertEqual(ctx.exception.target_stage_id, 9999)

    def test_create_inactive_stage_raises(self):
        self.ssvc.delete(self.conn, self.stage.id)
        with self.assertRaises(InvalidStageTransitionError):
            self.svc.create(self.conn, DealCreateRequest(name="X", stage_id=self.stage.id))

    def test_negative_amount_raises_validation(self):
        with self.assertRaises(ValueError):
            DealCreateRequest(name="Bad", stage_id=1, amount_uzs=Decimal("-1"))

    def test_empty_name_raises_validation(self):
        with self.assertRaises(ValueError):
            DealCreateRequest(name="", stage_id=1)

    def test_name_too_long_raises_validation(self):
        with self.assertRaises(ValueError):
            DealCreateRequest(name="N" * 241, stage_id=1)

    def test_zero_stage_id_raises_validation(self):
        with self.assertRaises(ValueError):
            DealCreateRequest(name="X", stage_id=0)

    def test_amount_coercion_from_string(self):
        r = self.svc.create(self.conn, DealCreateRequest(
            name="Coerce", stage_id=self.stage.id, amount_uzs="2500000.50"  # type: ignore
        ))
        self.assertEqual(r.amount_uzs, Decimal("2500000.50"))

    def test_invalid_amount_string_raises(self):
        with self.assertRaises(ValueError):
            DealCreateRequest(name="X", stage_id=1, amount_uzs="not-a-number")  # type: ignore

    def test_name_whitespace_stripped(self):
        r = self.svc.create(self.conn, DealCreateRequest(
            name="  Padded  ", stage_id=self.stage.id
        ))
        self.assertEqual(r.name, "Padded")


class TestDealRead(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = DealService()
        self.ssvc  = StageService()
        self.s1 = self.ssvc.create(self.conn, StageCreateRequest(name="S1", order_index=0))
        self.s2 = self.ssvc.create(self.conn, StageCreateRequest(name="S2", order_index=1))

    def _deal(self, name="D", stage_id=None, amount=Decimal("1000")):
        sid = stage_id or self.s1.id
        return self.svc.create(self.conn, DealCreateRequest(name=name, stage_id=sid, amount_uzs=amount))

    def test_get_existing(self):
        d = self._deal("My Deal")
        fetched = self.svc.get(self.conn, d.id)
        self.assertEqual(fetched.id, d.id)
        self.assertEqual(fetched.name, "My Deal")

    def test_get_nonexistent_raises(self):
        with self.assertRaises(DealNotFoundError) as ctx:
            self.svc.get(self.conn, 9999)
        self.assertEqual(ctx.exception.deal_id, 9999)
        self.assertEqual(ctx.exception.code, "deal_not_found")

    def test_list_all(self):
        self._deal("D1"); self._deal("D2")
        self.assertEqual(len(self.svc.list_all(self.conn)), 2)

    def test_list_filter_by_stage(self):
        self._deal("In S1", self.s1.id)
        self._deal("In S2", self.s2.id)
        in_s1 = self.svc.list_all(self.conn, stage_id=self.s1.id)
        self.assertEqual(len(in_s1), 1)
        self.assertEqual(in_s1[0].stage_id, self.s1.id)

    def test_list_empty(self):
        self.assertEqual(self.svc.list_all(self.conn), [])

    def test_list_ordered_desc_by_created_at(self):
        d1 = self._deal("First")
        d2 = self._deal("Second")
        d3 = self._deal("Third")
        deals = self.svc.list_all(self.conn)
        self.assertEqual(deals[0].id, d3.id)
        self.assertEqual(deals[-1].id, d1.id)


class TestDealUpdate(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = DealService()
        self.ssvc  = StageService()
        self.s1 = self.ssvc.create(self.conn, StageCreateRequest(name="S1", order_index=0))
        self.s2 = self.ssvc.create(self.conn, StageCreateRequest(name="S2", order_index=1))

    def _deal(self, name="D", amount=Decimal("1000")):
        return self.svc.create(self.conn, DealCreateRequest(name=name, stage_id=self.s1.id, amount_uzs=amount))

    def test_update_name(self):
        d = self._deal("Old")
        upd = self.svc.update(self.conn, d.id, DealUpdateRequest(name="New"))
        self.assertEqual(upd.name, "New")

    def test_update_amount(self):
        d = self._deal(amount=Decimal("1_000"))
        upd = self.svc.update(self.conn, d.id, DealUpdateRequest(amount_uzs=Decimal("9_000")))
        self.assertEqual(upd.amount_uzs, Decimal("9_000"))

    def test_update_stage_id_valid(self):
        d = self._deal()
        upd = self.svc.update(self.conn, d.id, DealUpdateRequest(stage_id=self.s2.id))
        self.assertEqual(upd.stage_id, self.s2.id)

    def test_update_stage_id_invalid_raises(self):
        d = self._deal()
        with self.assertRaises(InvalidStageTransitionError):
            self.svc.update(self.conn, d.id, DealUpdateRequest(stage_id=9999))

    def test_update_nonexistent_deal_raises(self):
        with self.assertRaises(DealNotFoundError):
            self.svc.update(self.conn, 9999, DealUpdateRequest(name="X"))

    def test_empty_payload_raises_validation(self):
        with self.assertRaises(ValueError):
            DealUpdateRequest()

    def test_update_all_fields(self):
        d = self._deal("Old", Decimal("100"))
        upd = self.svc.update(self.conn, d.id, DealUpdateRequest(
            name="New", amount_uzs=Decimal("999"), stage_id=self.s2.id
        ))
        self.assertEqual(upd.name, "New")
        self.assertEqual(upd.amount_uzs, Decimal("999"))
        self.assertEqual(upd.stage_id, self.s2.id)


class TestDealMove(unittest.TestCase):

    def setUp(self):
        self.conn = fresh_db()
        self.svc  = DealService()
        self.ssvc = StageService()
        self.s1 = self.ssvc.create(self.conn, StageCreateRequest(name="S1", order_index=0))
        self.s2 = self.ssvc.create(self.conn, StageCreateRequest(name="S2", order_index=1))
        self.s3 = self.ssvc.create(self.conn, StageCreateRequest(name="S3", order_index=2))

    def _deal(self):
        return self.svc.create(self.conn, DealCreateRequest(name="D", stage_id=self.s1.id))

    def test_move_to_valid_stage(self):
        d = self._deal()
        moved = self.svc.move(self.conn, d.id, DealMoveRequest(self.s2.id))
        self.assertEqual(moved.stage_id, self.s2.id)

    def test_move_through_full_pipeline(self):
        d = self._deal()
        d = self.svc.move(self.conn, d.id, DealMoveRequest(self.s2.id))
        self.assertEqual(d.stage_id, self.s2.id)
        d = self.svc.move(self.conn, d.id, DealMoveRequest(self.s3.id))
        self.assertEqual(d.stage_id, self.s3.id)
        d = self.svc.move(self.conn, d.id, DealMoveRequest(self.s1.id))
        self.assertEqual(d.stage_id, self.s1.id)

    def test_move_to_same_stage_idempotent(self):
        d = self._deal()
        moved = self.svc.move(self.conn, d.id, DealMoveRequest(self.s1.id))
        self.assertEqual(moved.stage_id, self.s1.id)

    def test_move_to_nonexistent_raises(self):
        d = self._deal()
        with self.assertRaises(InvalidStageTransitionError) as ctx:
            self.svc.move(self.conn, d.id, DealMoveRequest(9999))
        self.assertEqual(ctx.exception.target_stage_id, 9999)

    def test_move_to_inactive_stage_raises(self):
        s_inactive = self.ssvc.create(self.conn, StageCreateRequest(name="Inactive", order_index=3))
        d = self._deal()
        self.ssvc.delete(self.conn, s_inactive.id)
        with self.assertRaises(InvalidStageTransitionError):
            self.svc.move(self.conn, d.id, DealMoveRequest(s_inactive.id))

    def test_move_nonexistent_deal_raises(self):
        with self.assertRaises(DealNotFoundError):
            self.svc.move(self.conn, 9999, DealMoveRequest(self.s1.id))

    def test_zero_target_stage_raises_validation(self):
        with self.assertRaises(ValueError):
            DealMoveRequest(0)


class TestDealDelete(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = DealService()
        self.ssvc  = StageService()
        self.stage = self.ssvc.create(self.conn, StageCreateRequest(name="S"))

    def _deal(self, name="D"):
        return self.svc.create(self.conn, DealCreateRequest(name=name, stage_id=self.stage.id))

    def test_delete_existing(self):
        d = self._deal()
        result = self.svc.delete(self.conn, d.id)
        self.assertEqual(result["deleted_deal_id"], d.id)
        with self.assertRaises(DealNotFoundError):
            self.svc.get(self.conn, d.id)

    def test_delete_nonexistent_raises(self):
        with self.assertRaises(DealNotFoundError):
            self.svc.delete(self.conn, 9999)

    def test_delete_reduces_list(self):
        d1 = self._deal("Keep")
        d2 = self._deal("Gone")
        self.svc.delete(self.conn, d2.id)
        ids = [d.id for d in self.svc.list_all(self.conn)]
        self.assertIn(d1.id, ids)
        self.assertNotIn(d2.id, ids)


class TestIntegration(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = DealService()
        self.ssvc  = StageService()

    def _stage(self, name, order=0):
        return self.ssvc.create(self.conn, StageCreateRequest(name=name, order_index=order))

    def _deal(self, name, stage_id, amount=Decimal("1000")):
        return self.svc.create(self.conn, DealCreateRequest(name=name, stage_id=stage_id, amount_uzs=amount))

    def test_deals_survive_stage_rename(self):
        s = self._stage("Before")
        d = self._deal("Deal", s.id)
        self.ssvc.update(self.conn, s.id, StageUpdateRequest(name="After"))
        fetched = self.svc.get(self.conn, d.id)
        self.assertEqual(fetched.stage_id, s.id)

    def test_deals_block_stage_delete_without_migrate(self):
        s = self._stage("Blocked")
        self._deal("Blocking", s.id)
        with self.assertRaises(StageHasActiveDealsError):
            self.ssvc.delete(self.conn, s.id, migrate=False)
        still_there = self.ssvc.get(self.conn, s.id)
        self.assertTrue(still_there.is_active)

    def test_full_lifecycle(self):
        s1 = self._stage("Contact",     0)
        s2 = self._stage("Negotiation", 1)
        s3 = self._stage("Closing",     2)
        d1 = self._deal("Enterprise", s1.id, Decimal("50_000_000"))
        d2 = self._deal("SMB Client", s1.id, Decimal("5_000_000"))

        d1 = self.svc.move(self.conn, d1.id, DealMoveRequest(s2.id))
        d1 = self.svc.move(self.conn, d1.id, DealMoveRequest(s3.id))
        self.assertEqual(d1.stage_id, s3.id)

        snap = self.ssvc.pipeline_snapshot(self.conn)
        self.assertEqual(snap.grand_total_deals, 2)
        self.assertEqual(snap.grand_total_amount_uzs, Decimal("55_000_000"))

        self.svc.delete(self.conn, d2.id)
        with self.assertRaises(StageHasActiveDealsError):
            self.ssvc.delete(self.conn, s3.id, migrate=False)
        res = self.ssvc.delete(self.conn, s3.id, migrate=True)
        self.assertEqual(res["fallback_stage_id"], s1.id)
        final = self.ssvc.pipeline_snapshot(self.conn)
        self.assertEqual(final.grand_total_deals, 1)

    def test_aggregation_updates_after_move(self):
        s1 = self._stage("From", 0)
        s2 = self._stage("To",   1)
        d  = self._deal("D", s1.id, Decimal("1_000_000"))

        snap = self.ssvc.pipeline_snapshot(self.conn)
        by_id = {a.stage_id: a for a in snap.stages}
        self.assertEqual(by_id[s1.id].deal_count, 1)
        self.assertEqual(by_id[s2.id].deal_count, 0)

        self.svc.move(self.conn, d.id, DealMoveRequest(s2.id))
        snap2 = self.ssvc.pipeline_snapshot(self.conn)
        by_id2 = {a.stage_id: a for a in snap2.stages}
        self.assertEqual(by_id2[s1.id].deal_count, 0)
        self.assertEqual(by_id2[s2.id].deal_count, 1)
        self.assertEqual(snap2.grand_total_amount_uzs, Decimal("1_000_000"))

    def test_error_payloads(self):
        err = StageHasActiveDealsError(5, 3)
        self.assertEqual(err.to_dict()["error"], "stage_has_active_deals")
        self.assertIn("3", err.to_dict()["message"])

        err2 = InvalidStageTransitionError(99)
        self.assertEqual(err2.to_dict()["error"], "invalid_stage_transition")


if __name__ == "__main__":
    unittest.main()
