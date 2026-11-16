from __future__ import annotations

class LLMClientError(RuntimeError):
    """Controlled error for optional LLM client failures."""

    def __init__(self, message: str, *, diagnostic_category: str | None=None, http_status_code: int | None=None) -> None:
        super().__init__(message)
        self.diagnostic_category = diagnostic_category
        self.http_status_code = http_status_code

class BudgetExceeded(RuntimeError):
    pass

class MissingDecision(RuntimeError):
    pass

class DecisionIntegrityError(RuntimeError):
    pass
