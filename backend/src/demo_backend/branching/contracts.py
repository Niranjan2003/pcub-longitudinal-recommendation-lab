from __future__ import annotations
from typing import Literal
from pydantic import Field
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.research import Contract
from demo_backend.domain.research import HistoryEntry
from demo_backend.domain.research import RecommenderAction
from demo_backend.domain.research import ResearchInitialState
from demo_backend.domain.research import VersionedReference
from demo_backend.domain.versions import BRANCH_ENGINE_VERSION
from demo_backend.domain.versions import BRANCH_NODE_VERSION

class BranchSnapshot(Contract):
    """Deeply immutable branch-local state; no persistence handle is permitted."""
    state: ResearchInitialState
    history: tuple[HistoryEntry, ...] = ()
    recent_recipe_ids: tuple[str, ...] = ()
    accepted_recipe_ids: tuple[str, ...] = ()
    rejected_recipe_ids: tuple[str, ...] = ()
    recent_preference_feedback: tuple[str, ...] = ()
    rng_namespace: str

class UtilityComponents(Contract):
    state_component: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    action_component: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    synthetic_branch_utility: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)

class PolicyBranchEvidence(Contract):
    policy: VersionedReference
    calibrated_step_probability: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    calibrated_cumulative_probability: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    downstream_action: RecommenderAction
    utility: UtilityComponents

class ExpansionCost(Contract):
    branch_node_expansions: Literal[1] = 1
    predictor_calls: int = Field(ge=0)
    recommender_calls: int = Field(ge=0)
    llm_calls: Literal[0] = 0
    llm_tokens: Literal[0] = 0

class BranchNode(Contract):
    schema_version: Literal[BRANCH_NODE_VERSION] = BRANCH_NODE_VERSION
    node_id: str
    parent_node_id: str | None
    depth: int = Field(ge=1, le=2)
    profile_id: str
    scenario_id: str
    hypothetical_reaction: ResearchReaction
    branch_path: tuple[ResearchReaction, ...] = Field(min_length=1, max_length=2)
    calibrated_reaction_probability: float = Field(ge=0.0, le=1.0)
    cumulative_path_probability: float = Field(ge=0.0, le=1.0)
    cloned_dynamic_state: ResearchInitialState
    permitted_history_summary: tuple[str, ...]
    policy_evidence: tuple[PolicyBranchEvidence, ...] = Field(min_length=2, max_length=2)
    expansion_cost: ExpansionCost
    engine: VersionedReference = Field(default_factory=lambda: VersionedReference(identifier='branch_safe_simulation', version=BRANCH_ENGINE_VERSION))
    provenance: tuple[VersionedReference, ...]

class BranchRunResult(Contract):
    root_context_id: str
    allocator_id: str
    allocator_version: str
    budget: int = Field(ge=1)
    actual_expansions: int = Field(ge=0)
    predictor_calls: int = Field(ge=0)
    recommender_calls: int = Field(ge=0)
    llm_calls: Literal[0] = 0
    llm_tokens: Literal[0] = 0
    expansion_order: tuple[str, ...]
    nodes: tuple[BranchNode, ...]
    estimated_policy_values: dict[str, float]
    selected_policy: str
    selected_action: RecommenderAction

class FrontierCandidate(Contract):
    """Allocator-facing object. Oracle probabilities are structurally absent."""
    candidate_id: str
    parent_node_id: str | None = None
    depth: int = Field(ge=1, le=2)
    reaction: ResearchReaction
    first_reaction: ResearchReaction
    policy_step_probabilities: tuple[float, float]
    policy_cumulative_probabilities: tuple[float, float]
    probability_component: float = Field(ge=0.0, le=1.0)
    uncertainty_component: float = Field(ge=0.0, le=1.0)
    disagreement_component: float = Field(ge=0.0, le=1.0)
    cost_component: float = Field(ge=0.0, le=1.0)
