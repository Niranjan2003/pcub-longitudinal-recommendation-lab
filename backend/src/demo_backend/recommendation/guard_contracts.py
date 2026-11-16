from __future__ import annotations
from enum import Enum
from typing import Literal
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

class ReasonCode(str, Enum):
    EFFORT_FIT = 'EFFORT_FIT'
    TASTE_FIT = 'TASTE_FIT'
    HEALTH_FIT = 'HEALTH_FIT'
    RECENT_REQUEST_MATCH = 'RECENT_REQUEST_MATCH'
    AVOID_RECENT_REJECTION_PATTERN = 'AVOID_RECENT_REJECTION_PATTERN'
    POSITIVE_HISTORY_MATCH = 'POSITIVE_HISTORY_MATCH'
    NOVELTY = 'NOVELTY'
    AVOID_REPETITION = 'AVOID_REPETITION'
    BALANCED_TRADEOFF = 'BALANCED_TRADEOFF'
    MISSING_DATA_CAUTION = 'MISSING_DATA_CAUTION'

class LiveSettings(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    provider: str
    model: str
    logical_role: Literal['reasoning'] = 'reasoning'
    task: Literal['manual_reranker'] = 'manual_reranker'
    routing_profile: Literal['candidate_v1'] = 'candidate_v1'
    temperature: Literal[0] = 0
    max_output_tokens: int = Field(default=4096, ge=128, le=8192)
    timeout_seconds: int = Field(default=60, ge=1, le=120)
    transport_retries: Literal[0] = 0
    seed: int | None = None
    seed_support: str = 'NOT_ESTABLISHED; no unsupported seed sent'
    client_version: str = 'v3_bounded_openai_compatible_v1'
    response_format: Literal['prompt_only', 'json_schema'] = 'prompt_only'

class GuardedRerankContext(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    version: Literal['guarded_rerank_context_v1'] = 'guarded_rerank_context_v1'
    declared_profile: dict
    observable_state: dict[str, float]
    completed_history: list[dict] = Field(max_length=6)
    recent_exposure_ids: list[str] = Field(max_length=6)
    recent_accepted_recipe_ids: list[str] = Field(max_length=6)
    recent_rejected_recipe_ids: list[str] = Field(max_length=6)
    preference_feedback: list[str] = Field(max_length=6)
    current_request: str = Field(max_length=600)
    session_index: int = Field(ge=1)
    turn_index: int = Field(ge=1)
    candidates: list[dict] = Field(min_length=1, max_length=10)

    @model_validator(mode='after')
    def unique_ids(self):
        ids = [c['recipe_id'] for c in self.candidates]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate candidate identifiers')
        return self

class InvalidDecision(ValueError):

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)
