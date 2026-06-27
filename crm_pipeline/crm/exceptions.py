"""
crm.exceptions
~~~~~~~~~~~~~~
Domain-level exception hierarchy.
Every exception carries a machine-readable ``code`` string.
"""
from __future__ import annotations


class CRMError(Exception):
    code: str = "crm_error"

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code

    def to_dict(self) -> dict[str, str]:
        return {"error": self.code, "message": self.message}


# ── Stage exceptions ──────────────────────────────────────────────────────────

class StageNotFoundError(CRMError):
    code = "stage_not_found"
    def __init__(self, stage_id: int) -> None:
        super().__init__(f"Stage id={stage_id} does not exist.")
        self.stage_id = stage_id

class StageHasActiveDealsError(CRMError):
    code = "stage_has_active_deals"
    def __init__(self, stage_id: int, deal_count: int) -> None:
        super().__init__(
            f"Stage id={stage_id} owns {deal_count} active deal(s). "
            "Migrate them first or pass migrate=True."
        )
        self.stage_id  = stage_id
        self.deal_count = deal_count

class StageNameConflictError(CRMError):
    code = "stage_name_conflict"
    def __init__(self, name: str) -> None:
        super().__init__(f"A stage named '{name}' already exists.")
        self.name = name

class NoFallbackStageError(CRMError):
    code = "no_fallback_stage"
    def __init__(self, stage_id: int) -> None:
        super().__init__(
            f"Cannot migrate deals from stage id={stage_id}: "
            "no other active stage exists."
        )
        self.stage_id = stage_id


# ── Deal exceptions ───────────────────────────────────────────────────────────

class DealNotFoundError(CRMError):
    code = "deal_not_found"
    def __init__(self, deal_id: int) -> None:
        super().__init__(f"Deal id={deal_id} does not exist.")
        self.deal_id = deal_id

class InvalidStageTransitionError(CRMError):
    code = "invalid_stage_transition"
    def __init__(self, target_stage_id: int) -> None:
        super().__init__(
            f"Cannot move deal to stage id={target_stage_id}: "
            "stage does not exist or is inactive."
        )
        self.target_stage_id = target_stage_id

class DealValidationError(CRMError):
    code = "deal_validation_error"
