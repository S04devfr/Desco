"""
main.py — CRM Pipeline Demo
============================
Runs with: python main.py (no external dependencies required)
"""
from __future__ import annotations
import logging, sys
from decimal import Decimal
from crm.database import _connect, create_schema
from crm.schemas import DealCreateRequest, DealMoveRequest, StageCreateRequest, StageUpdateRequest
from crm.services.deal_service import DealService
from crm.services.stage_service import StageService, seed_default_stages

logging.basicConfig(level=logging.WARNING, handlers=[logging.StreamHandler(sys.stdout)])
SEP = "─" * 66

def main() -> None:
    conn = _connect(":memory:")
    create_schema(conn)
    stage_svc = StageService()
    deal_svc  = DealService()

    print(f"\n{SEP}\n1. Seeding default stages …")
    stages = seed_default_stages(conn)
    for s in stages:
        print(f"   ✓ [{s.id}] {s.name}  (order={s.order_index})")

    print(f"\n{SEP}\n2. Adding custom stage …")
    closed = stage_svc.create(conn, StageCreateRequest(name="ЗАКРЫТАЯ СДЕЛКА", order_index=3))
    print(f"   ✓ [{closed.id}] {closed.name}")

    print(f"\n{SEP}\n3. Adding deals …")
    s1, s2, s3 = stages[0].id, stages[1].id, stages[2].id
    d1 = deal_svc.create(conn, DealCreateRequest("Алишер — Корп. пакет", s1, Decimal("12_500_000")))
    d2 = deal_svc.create(conn, DealCreateRequest("Зафар — Базовый",       s1, Decimal("3_750_000")))
    d3 = deal_svc.create(conn, DealCreateRequest("Малика — Премиум",       s2, Decimal("28_000_000")))
    for d in (d1, d2, d3):
        print(f"   ✓ [{d.id}] {d.name:<30s} {d.amount_uzs:>14,.2f} UZS → stage {d.stage_id}")

    print(f"\n{SEP}\n4. Moving deal [{d2.id}] through pipeline …")
    for tid, label in [(s2, stages[1].name), (s3, stages[2].name), (closed.id, closed.name)]:
        d2 = deal_svc.move(conn, d2.id, DealMoveRequest(tid))
        print(f"   → [{tid}] {label}")

    print(f"\n{SEP}\n5. Pipeline snapshot:")
    snap = stage_svc.pipeline_snapshot(conn)
    for agg in snap.stages:
        bar = "█" * agg.deal_count
        print(f"   [{agg.stage_id:2d}] {agg.stage_name:<28s} {bar:<4s} {agg.deal_count} deal(s) "
              f"{agg.total_amount_uzs:>16,.2f} UZS")
    print(f"   {'GRAND TOTAL':<33s} {snap.grand_total_deals} deal(s) "
          f"{snap.grand_total_amount_uzs:>16,.2f} UZS")

    print(f"\n{SEP}\n6. Renaming first stage …")
    upd = stage_svc.update(conn, s1, StageUpdateRequest(name="ПЕРВЫЙ КОНТАКТ (обновлён)"))
    print(f"   ✓ [{upd.id}] → '{upd.name}'")

    print(f"\n{SEP}\n7. Safe-delete closed stage (migrate deals) …")
    res = stage_svc.delete(conn, closed.id, migrate=True)
    print(f"   ✓ Stage {res['deleted_stage_id']} deleted, "
          f"{res['migrated_deal_count']} deal(s) → stage {res['fallback_stage_id']}")

    print(f"\n{SEP}\nFinal snapshot:")
    snap2 = stage_svc.pipeline_snapshot(conn)
    for agg in snap2.stages:
        bar = "█" * agg.deal_count
        print(f"   [{agg.stage_id:2d}] {agg.stage_name:<32s} {bar:<4s} {agg.deal_count} deal(s) "
              f"{agg.total_amount_uzs:>16,.2f} UZS")
    print(f"\n{SEP}\nDemo complete ✓\n")

if __name__ == "__main__":
    main()
