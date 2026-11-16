from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol
from typing import runtime_checkable
from demo_backend.domain.platform import DynamicUserState
from demo_backend.domain.platform import RecipeItem
from demo_backend.domain.platform import RecommendationAgentOutput
from demo_backend.domain.platform import UserPersona

@dataclass(frozen=True, slots=True)
class RecommendationContext:
    """Only information available at the recommendation decision boundary."""
    persona: UserPersona
    state: DynamicUserState
    recipes: tuple[RecipeItem, ...]
    turn_index: int
    memory_context: dict

@runtime_checkable
class RecommendationPolicy(Protocol):
    policy_id: str
    policy_version: str
    deterministic: bool

    def recommend(self, context: RecommendationContext) -> RecommendationAgentOutput:
        """Return the existing structured recommendation contract."""
