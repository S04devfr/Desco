"""
crm.schemas
~~~~~~~~~~~
Validated request / response dataclasses (Pydantic-style, pure stdlib).

* Validation runs in ``__post_init__`` — raises ``ValueError`` on bad input,
  matching Pydantic's ``ValidationError`` semantics for callers.
* Response dataclasses are plain frozen containers built from DB rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional


# ── helpers ───────────────────────────────────────────────────────────────────

def _strip(s: object) -> str:
    if not isinstance(s, str):
        raise ValueError(f"Expected str, got {type(s).__name__}")
    return s.strip()

def _to_decimal(v: object) -> Decimal:
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError(f"Invalid decimal value: {v!r}") from exc


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class StageCreateRequest:
    name: str
    order_index: int = 0

    def __post_init__(self) -> None:
        self.name = _strip(self.name)
        if not self.name:
            raise ValueError("name must not be empty")
        if len(self.name) > 120:
            raise ValueError("name must not exceed 120 characters")
        if not isinstance(self.order_index, int) or self.order_index < 0:
            raise ValueError("order_index must be a non-negative integer")


@dataclass
class StageUpdateRequest:
    name: Optional[str] = None
    order_index: Optional[int] = None

    def __post_init__(self) -> None:
        if self.name is None and self.order_index is None:
            raise ValueError("At least one of 'name' or 'order_index' must be provided")
        if self.name is not None:
            self.name = _strip(self.name)
            if not self.name:
                raise ValueError("name must not be empty")
            if len(self.name) > 120:
                raise ValueError("name must not exceed 120 characters")
        if self.order_index is not None and self.order_index < 0:
            raise ValueError("order_index must be non-negative")


@dataclass(frozen=True)
class StageResponse:
    id: int
    name: str
    order_index: int
    is_active: bool
    created_at: datetime


@dataclass(frozen=True)
class StageAggregation:
    stage_id: int
    stage_name: str
    deal_count: int
    total_amount_uzs: Decimal


@dataclass(frozen=True)
class PipelineSnapshot:
    stages: list
    grand_total_deals: int
    grand_total_amount_uzs: Decimal


# ══════════════════════════════════════════════════════════════════════════════
#  DEAL SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class DealCreateRequest:
    name: str
    stage_id: int
    amount_uzs: Decimal = field(default_factory=lambda: Decimal("0.00"))

    def __post_init__(self) -> None:
        self.name = _strip(self.name)
        if not self.name:
            raise ValueError("name must not be empty")
        if len(self.name) > 240:
            raise ValueError("name must not exceed 240 characters")
        self.amount_uzs = _to_decimal(self.amount_uzs)
        if self.amount_uzs < 0:
            raise ValueError("amount_uzs must be non-negative")
        if not isinstance(self.stage_id, int) or self.stage_id <= 0:
            raise ValueError("stage_id must be a positive integer")


@dataclass
class DealUpdateRequest:
    name: Optional[str] = None
    amount_uzs: Optional[Decimal] = None
    stage_id: Optional[int] = None

    def __post_init__(self) -> None:
        if self.name is None and self.amount_uzs is None and self.stage_id is None:
            raise ValueError("At least one field must be provided")
        if self.name is not None:
            self.name = _strip(self.name)
            if not self.name:
                raise ValueError("name must not be empty")
        if self.amount_uzs is not None:
            self.amount_uzs = _to_decimal(self.amount_uzs)
            if self.amount_uzs < 0:
                raise ValueError("amount_uzs must be non-negative")
        if self.stage_id is not None and self.stage_id <= 0:
            raise ValueError("stage_id must be positive")


@dataclass
class DealMoveRequest:
    target_stage_id: int

    def __post_init__(self) -> None:
        if not isinstance(self.target_stage_id, int) or self.target_stage_id <= 0:
            raise ValueError("target_stage_id must be a positive integer")


@dataclass(frozen=True)
class DealResponse:
    id: int
    name: str
    amount_uzs: Decimal
    stage_id: int
    created_at: datetime
