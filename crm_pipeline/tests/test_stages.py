"""
tests/test_stages.py  —  StageService comprehensive unit tests (stdlib unittest)
"""
from __future__ import annotations
import sys, os
sys.path.insert(0, "/tmp/crm_pipeline")

import unittest
from decimal import Decimal
from crm.database import _connect, create_schema
from crm.exceptions import (
    StageNotFoundError, StageHasActiveDealsError,
    StageNameConflictError, NoFallbackStageError,
)
from crm.schemas import StageCreateRequest, StageUpdateRequest
from crm.services.stage_service import StageService, seed_default_stages
from crm.services.deal_service import DealService
from crm.schemas import DealCreateRequest


def fresh_db():
    conn = _connect(":memory:")
    create_schema(conn)
    return conn


class TestStageCreate(unittest.TestCase):

    def setUp(self):
        self.conn = fresh_db()
        self.svc  = StageService()

    def test_creates_with_required_fields(self):
        r = self.svc.create(self.conn, StageCreateRequest(name="Alpha"))
        self.assertGreater(r.id, 0)
        self.assertEqual(r.name, "Alpha")
        self.assertEqual(r.order_index, 0)
        self.assertTrue(r.is_active)
        self.assertIsNotNone(r.created_at)

    def test_creates_with_explicit_order(self):
        r = self.svc.create(self.conn, StageCreateRequest(name="Beta", order_index=5))
        self.assertEqual(r.order_index, 5)

    def test_name_conflict_raises(self):
        self.svc.create(self.conn, StageCreateRequest(name="Dupe"))
        with self.assertRaises(StageNameConflictError) as ctx:
            self.svc.create(self.conn, StageCreateRequest(name="Dupe"))
        self.assertEqual(ctx.exception.code, "stage_name_conflict")
        self.assertEqual(ctx.exception.name, "Dupe")

    def test_name_conflict_case_sensitive(self):
        self.svc.create(self.conn, StageCreateRequest(name="Dupe"))
        r = self.svc.create(self.conn, StageCreateRequest(name="dupe"))
        self.assertEqual(r.name, "dupe")

    def test_whitespace_stripped_from_name(self):
        r = self.svc.create(self.conn, StageCreateRequest(name="  Spaces  "))
        self.assertEqual(r.name, "Spaces")

    def test_empty_name_raises_validation(self):
        with self.assertRaises(ValueError):
            StageCreateRequest(name="")

    def test_negative_order_raises_validation(self):
        with self.assertRaises(ValueError):
            StageCreateRequest(name="X", order_index=-1)

    def test_name_too_long_raises_validation(self):
        with self.assertRaises(ValueError):
            StageCreateRequest(name="A" * 121)


class TestStageRead(unittest.TestCase):

    def setUp(self):
        self.conn = fresh_db()
        self.svc  = StageService()

    def test_get_existing(self):
        created = self.svc.create(self.conn, StageCreateRequest(name="Gamma"))
        fetched = self.svc.get(self.conn, created.id)
        self.assertEqual(fetched.id, created.id)
        self.assertEqual(fetched.name, "Gamma")

    def test_get_nonexistent_raises(self):
        with self.assertRaises(StageNotFoundError) as ctx:
            self.svc.get(self.conn, 9999)
        self.assertEqual(ctx.exception.stage_id, 9999)
        self.assertEqual(ctx.exception.code, "stage_not_found")

    def test_list_sorted_by_order_index(self):
        self.svc.create(self.conn, StageCreateRequest(name="C", order_index=2))
        self.svc.create(self.conn, StageCreateRequest(name="A", order_index=0))
        self.svc.create(self.conn, StageCreateRequest(name="B", order_index=1))
        stages = self.svc.list_all(self.conn)
        self.assertEqual([s.name for s in stages], ["A", "B", "C"])

    def test_list_excludes_inactive(self):
        s1 = self.svc.create(self.conn, StageCreateRequest(name="Active"))
        s2 = self.svc.create(self.conn, StageCreateRequest(name="ToDelete", order_index=1))
        self.svc.delete(self.conn, s2.id, migrate=False)
        stages = self.svc.list_all(self.conn)
        ids = [s.id for s in stages]
        self.assertIn(s1.id, ids)
        self.assertNotIn(s2.id, ids)

    def test_list_empty_pipeline(self):
        self.assertEqual(self.svc.list_all(self.conn), [])


class TestStageUpdate(unittest.TestCase):

    def setUp(self):
        self.conn = fresh_db()
        self.svc  = StageService()

    def test_rename(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="Old"))
        upd = self.svc.update(self.conn, s.id, StageUpdateRequest(name="New"))
        self.assertEqual(upd.name, "New")

    def test_reorder(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="X"))
        upd = self.svc.update(self.conn, s.id, StageUpdateRequest(order_index=10))
        self.assertEqual(upd.order_index, 10)

    def test_rename_and_reorder_together(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="Old"))
        upd = self.svc.update(self.conn, s.id, StageUpdateRequest(name="New", order_index=7))
        self.assertEqual(upd.name, "New")
        self.assertEqual(upd.order_index, 7)

    def test_rename_to_same_name_is_fine(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="Same"))
        upd = self.svc.update(self.conn, s.id, StageUpdateRequest(name="Same"))
        self.assertEqual(upd.name, "Same")

    def test_rename_conflict_raises(self):
        self.svc.create(self.conn, StageCreateRequest(name="Existing"))
        s = self.svc.create(self.conn, StageCreateRequest(name="Other", order_index=1))
        with self.assertRaises(StageNameConflictError):
            self.svc.update(self.conn, s.id, StageUpdateRequest(name="Existing"))

    def test_update_nonexistent_raises(self):
        with self.assertRaises(StageNotFoundError):
            self.svc.update(self.conn, 9999, StageUpdateRequest(name="X"))

    def test_empty_payload_raises_validation(self):
        with self.assertRaises(ValueError):
            StageUpdateRequest()


class TestStageDeletion(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = StageService()
        self.dsvc  = DealService()

    def _make_deal(self, name, stage_id, amount=Decimal("1000")):
        return self.dsvc.create(self.conn, DealCreateRequest(name=name, stage_id=stage_id, amount_uzs=amount))

    def test_delete_empty_stage(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="Empty"))
        res = self.svc.delete(self.conn, s.id)
        self.assertEqual(res["deleted_stage_id"], s.id)
        self.assertEqual(res["migrated_deal_count"], 0)
        self.assertIsNone(res["fallback_stage_id"])
        with self.assertRaises(StageNotFoundError):
            self.svc.get(self.conn, s.id)

    def test_delete_with_deals_rejected_by_default(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="HasDeals"))
        self._make_deal("D1", s.id)
        self._make_deal("D2", s.id)
        with self.assertRaises(StageHasActiveDealsError) as ctx:
            self.svc.delete(self.conn, s.id)
        self.assertEqual(ctx.exception.deal_count, 2)
        self.assertEqual(ctx.exception.code, "stage_has_active_deals")

    def test_delete_with_migration_reassigns_deals(self):
        src  = self.svc.create(self.conn, StageCreateRequest(name="Source",  order_index=0))
        dest = self.svc.create(self.conn, StageCreateRequest(name="Dest",    order_index=1))
        d1 = self._make_deal("D1", src.id)
        d2 = self._make_deal("D2", src.id)
        res = self.svc.delete(self.conn, src.id, migrate=True)
        self.assertEqual(res["migrated_deal_count"], 2)
        self.assertEqual(res["fallback_stage_id"], dest.id)
        deals = self.dsvc.list_all(self.conn, stage_id=dest.id)
        self.assertEqual({d.id for d in deals}, {d1.id, d2.id})

    def test_migrate_picks_lowest_order_fallback(self):
        src = self.svc.create(self.conn, StageCreateRequest(name="Source", order_index=0))
        hi  = self.svc.create(self.conn, StageCreateRequest(name="High",   order_index=99))
        lo  = self.svc.create(self.conn, StageCreateRequest(name="Low",    order_index=1))
        self._make_deal("X", src.id)
        res = self.svc.delete(self.conn, src.id, migrate=True)
        self.assertEqual(res["fallback_stage_id"], lo.id)

    def test_only_stage_with_deals_raises_no_fallback(self):
        only = self.svc.create(self.conn, StageCreateRequest(name="Only"))
        self._make_deal("Lonely", only.id)
        with self.assertRaises(NoFallbackStageError) as ctx:
            self.svc.delete(self.conn, only.id, migrate=True)
        self.assertEqual(ctx.exception.code, "no_fallback_stage")

    def test_delete_nonexistent_raises(self):
        with self.assertRaises(StageNotFoundError):
            self.svc.delete(self.conn, 9999)

    def test_double_delete_raises(self):
        s = self.svc.create(self.conn, StageCreateRequest(name="Gone"))
        self.svc.delete(self.conn, s.id)
        with self.assertRaises(StageNotFoundError):
            self.svc.delete(self.conn, s.id)


class TestPipelineSnapshot(unittest.TestCase):

    def setUp(self):
        self.conn  = fresh_db()
        self.svc   = StageService()
        self.dsvc  = DealService()

    def _make_stage(self, name, order=0):
        return self.svc.create(self.conn, StageCreateRequest(name=name, order_index=order))

    def _make_deal(self, name, stage_id, amount=Decimal("1000")):
        return self.dsvc.create(self.conn, DealCreateRequest(name=name, stage_id=stage_id, amount_uzs=amount))

    def test_empty_pipeline(self):
        snap = self.svc.pipeline_snapshot(self.conn)
        self.assertEqual(snap.stages, [])
        self.assertEqual(snap.grand_total_deals, 0)
        self.assertEqual(snap.grand_total_amount_uzs, Decimal("0"))

    def test_stage_with_no_deals(self):
        self._make_stage("Empty")
        snap = self.svc.pipeline_snapshot(self.conn)
        self.assertEqual(len(snap.stages), 1)
        self.assertEqual(snap.stages[0].deal_count, 0)
        self.assertEqual(snap.stages[0].total_amount_uzs, Decimal("0"))

    def test_accurate_counts_and_sums(self):
        s1 = self._make_stage("S1", 0)
        s2 = self._make_stage("S2", 1)
        self._make_deal("A", s1.id, Decimal("1_000_000"))
        self._make_deal("B", s1.id, Decimal("2_000_000"))
        self._make_deal("C", s2.id, Decimal("500_000"))
        snap = self.svc.pipeline_snapshot(self.conn)
        self.assertEqual(snap.grand_total_deals, 3)
        self.assertEqual(snap.grand_total_amount_uzs, Decimal("3_500_000"))
        by_id = {a.stage_id: a for a in snap.stages}
        self.assertEqual(by_id[s1.id].deal_count, 2)
        self.assertEqual(by_id[s2.id].deal_count, 1)

    def test_ordered_by_order_index(self):
        self._make_stage("Z", 9)
        self._make_stage("A", 0)
        self._make_stage("M", 5)
        snap = self.svc.pipeline_snapshot(self.conn)
        self.assertEqual([a.stage_name for a in snap.stages], ["A", "M", "Z"])

    def test_excludes_inactive_stages(self):
        active   = self._make_stage("Active",   0)
        inactive = self._make_stage("Inactive", 1)
        self._make_deal("X", active.id)
        self.svc.delete(self.conn, inactive.id)
        snap = self.svc.pipeline_snapshot(self.conn)
        ids = {a.stage_id for a in snap.stages}
        self.assertIn(active.id, ids)
        self.assertNotIn(inactive.id, ids)

    def test_reflects_migration(self):
        src  = self._make_stage("Source",      0)
        dest = self._make_stage("Destination", 1)
        self._make_deal("D1", src.id, Decimal("100_000"))
        self._make_deal("D2", src.id, Decimal("200_000"))
        self.svc.delete(self.conn, src.id, migrate=True)
        snap = self.svc.pipeline_snapshot(self.conn)
        self.assertEqual(len(snap.stages), 1)
        self.assertEqual(snap.stages[0].deal_count, 2)
        self.assertEqual(snap.stages[0].total_amount_uzs, Decimal("300_000"))


class TestSeeding(unittest.TestCase):

    def setUp(self):
        self.conn = fresh_db()
        self.svc  = StageService()

    def test_seeds_three_stages(self):
        stages = seed_default_stages(self.conn)
        self.assertEqual(len(stages), 3)

    def test_seeds_correct_names(self):
        stages = seed_default_stages(self.conn)
        names = [s.name for s in stages]
        self.assertIn("ПЕРВИЧНЫЙ КОНТАКТ", names)
        self.assertIn("ПЕРЕГОВОРЫ",        names)
        self.assertIn("ПРИНИМАЮТ РЕШЕНИЕ", names)

    def test_seeds_in_ascending_order(self):
        stages = seed_default_stages(self.conn)
        orders = [s.order_index for s in stages]
        self.assertEqual(orders, sorted(orders))

    def test_idempotent_reseed(self):
        seed_default_stages(self.conn)
        seed_default_stages(self.conn)
        all_stages = self.svc.list_all(self.conn)
        self.assertEqual(len(all_stages), 3)

    def test_seed_with_existing_data_is_safe(self):
        self.svc.create(self.conn, StageCreateRequest(name="Custom"))
        seed_default_stages(self.conn)
        all_stages = self.svc.list_all(self.conn)
        self.assertEqual(len(all_stages), 4)


if __name__ == "__main__":
    unittest.main()
