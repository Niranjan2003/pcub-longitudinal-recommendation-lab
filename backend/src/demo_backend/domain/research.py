from __future__ import annotations
from typing import Annotated
from typing import Literal
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator
from demo_backend.domain.platform import DietaryPattern
from demo_backend.domain.platform import FrozenStrictModel
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.ontology import ChangeDimension
from demo_backend.domain.ontology import ResearchContinuation
from demo_backend.domain.ontology import ResearchReaction
import demo_backend.domain.versions as v

Text = Annotated[str, Field(min_length=1, strict=True)]

Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False, strict=True)]

Index = Annotated[int, Field(ge=1, strict=True)]

Seed = Annotated[int, Field(strict=True)]

Scalar = str | Annotated[bool, Field(strict=True)] | Annotated[int, Field(strict=True)] | Annotated[float, Field(strict=True, allow_inf_nan=False)]

class Contract(FrozenStrictModel):
    model_config = ConfigDict(extra='forbid', frozen=True, str_strip_whitespace=True, validate_default=True, revalidate_instances='always')

class VersionedReference(Contract):
    identifier: Text
    version: Text
    fingerprint: Text | None = None

class GenerationProvenance(Contract):
    generation_method: Text
    generation_seed: Seed
    generator: VersionedReference
    source_references: tuple[Text, ...] = ()

class RequestedChange(Contract):
    schema_version: Literal[v.REQUESTED_CHANGE_VERSION] = v.REQUESTED_CHANGE_VERSION
    dimensions: tuple[ChangeDimension, ...] = ()
    instruction: Text | None = None
    residual_text: Text | None = None

    @model_validator(mode='after')
    def meaningful(self):
        if len(set(self.dimensions)) != len(self.dimensions):
            raise ValueError('requested-change dimensions must be unique')
        if not (self.instruction or self.residual_text):
            raise ValueError('preserve an instruction or residual text')
        return self

class ResearchInitialState(Contract):
    """Bounded snapshot; does not change the permissive historical state model."""
    specification_version: Literal['pcub_initial_state_v1'] = 'pcub_initial_state_v1'
    trust: Unit
    motivation: Unit
    fatigue: Unit
    satisfaction: Unit
    engagement: Unit
    resistance: Unit
    recent_preferences: tuple[Text, ...] = ()
    avoided_recently: tuple[Text, ...] = ()
    notes: tuple[Text, ...] = ()

class ProfileCharacteristics(Contract):
    dietary_pattern: DietaryPattern
    allergies: tuple[Text, ...] = ()
    excluded_ingredients: tuple[Text, ...] = ()
    health_goals: tuple[Text, ...] = ()
    taste_preferences: tuple[Text, ...] = ()

class SimulationTendencies(Contract):
    budget_sensitivity: Unit
    preparation_effort_tolerance: Unit
    novelty_preference: Unit
    health_priority: Unit
    taste_priority: Unit
    constraint_sensitivity: Unit

class SimulatedResearchProfile(Contract):
    schema_version: Literal[v.PROFILE_SCHEMA_VERSION] = v.PROFILE_SCHEMA_VERSION
    protocol_version: Literal[v.PROTOCOL_VERSION] = v.PROTOCOL_VERSION
    profile_id: Text
    profile_version: Text
    generation: GenerationProvenance
    characteristics: ProfileCharacteristics
    tendencies: SimulationTendencies
    initial_state: ResearchInitialState | VersionedReference
    outcome_mechanism: VersionedReference
    outcome_parameterization: VersionedReference

class Position(Contract):
    session_index: Index
    turn_index: Index

    def key(self) -> tuple[int, int]:
        return (self.session_index, self.turn_index)

class SessionPlan(Contract):
    number_of_sessions: Index
    turns_per_session: Index

    def contains(self, position: Position) -> bool:
        return position.session_index <= self.number_of_sessions and position.turn_index <= self.turns_per_session

class CurrentContext(Contract):
    request: Text
    known_constraints: tuple[Text, ...] = ()
    context_notes: tuple[Text, ...] = ()

class ResearchScenario(Contract):
    schema_version: Literal[v.SCENARIO_SCHEMA_VERSION] = v.SCENARIO_SCHEMA_VERSION
    protocol_version: Literal[v.PROTOCOL_VERSION] = v.PROTOCOL_VERSION
    scenario_id: Text
    scenario_version: Text
    profile_id: Text
    profile_version: Text
    recommender_policy: VersionedReference
    dataset: VersionedReference
    session_plan: SessionPlan
    initial_context: CurrentContext
    root_seed: Seed
    simulation_seed_namespace: Text
    outcome_generator: VersionedReference
    research_ontology_version: Literal[v.REACTION_ONTOLOGY_VERSION] = v.REACTION_ONTOLOGY_VERSION
    condition_tags: tuple[Text, ...] = ()
    generation: GenerationProvenance

    def validate_profile(self, profile: SimulatedResearchProfile) -> None:
        if (self.profile_id, self.profile_version) != (profile.profile_id, profile.profile_version):
            raise ValueError('scenario/profile identity mismatch')
        if self.outcome_generator != profile.outcome_mechanism and 'outcome_mechanism_shift' not in self.condition_tags:
            raise ValueError('outcome generator differs without outcome_mechanism_shift tag')

class SelectedItem(Contract):
    item_id: Text
    title: Text
    ingredients: tuple[Text, ...] = ()
    dataset: VersionedReference
    known_constraints: tuple[Text, ...] = ()

class RecommenderAction(Contract):
    action_id: Text
    action_type: Text
    selected_item: SelectedItem | None = None
    explanation: str | None = None
    grounding: tuple[Text, ...] = ()

class LegalFeature(Contract):
    """Registered semantic feature; provenance must precede the current reaction."""
    feature_specification: VersionedReference
    value: Scalar
    available_at: Position
    source_evidence_ids: tuple[Text, ...]
    availability: Literal['PRE_REACTION'] = 'PRE_REACTION'

class HistoryEntry(Contract):
    position: Position
    action: RecommenderAction
    reaction: ResearchReaction | None = None
    continuation: ResearchContinuation | None = None
    requested_changes: tuple[RequestedChange, ...] = ()
    source_evidence_ids: tuple[Text, ...]

class PredictorInput(Contract):
    position: Position
    action: RecommenderAction
    recommender_policy: VersionedReference
    profile_features: ProfileCharacteristics
    context: CurrentContext
    history: tuple[HistoryEntry, ...] = ()
    features: tuple[LegalFeature, ...] = ()

    @model_validator(mode='after')
    def past_only(self):
        keys = [entry.position.key() for entry in self.history]
        if keys != sorted(set(keys)) or any((key >= self.position.key() for key in keys)):
            raise ValueError('history must be unique, ordered, and strictly earlier')
        if any((feature.available_at.key() > self.position.key() for feature in self.features)):
            raise ValueError('future feature is prohibited')
        return self

class SampleProvenance(Contract):
    root_seed: Seed
    simulation_seed_namespace: Text
    seed_derivation_version: Text
    derived_seed: Seed | None = None
    reaction_draw: Annotated[float, Field(ge=0, lt=1, allow_inf_nan=False, strict=True)] | None = None
    continuation_draw: Annotated[float, Field(ge=0, lt=1, allow_inf_nan=False, strict=True)] | None = None

class ResearchReactionProbabilities(Contract):
    ACCEPT: Unit
    MODIFY_CLARIFY: Unit
    DEFER: Unit
    REJECT: Unit

    @model_validator(mode='after')
    def normalized(self):
        values = [float(getattr(self, reaction.value)) for reaction in RESEARCH_REACTION_ORDER]
        if abs(sum(values) - 1.0) > 1e-09:
            raise ValueError('research-reaction probabilities must sum to one')
        return self

    def as_mapping(self) -> dict[ResearchReaction, float]:
        return {reaction: float(getattr(self, reaction.value)) for reaction in RESEARCH_REACTION_ORDER}

class AuthoritativeOutcome(Contract):
    research_ontology_version: Literal[v.REACTION_ONTOLOGY_VERSION] = v.REACTION_ONTOLOGY_VERSION
    continuation_ontology_version: Literal[v.CONTINUATION_ONTOLOGY_VERSION] = v.CONTINUATION_ONTOLOGY_VERSION
    reaction: ResearchReaction
    continuation: ResearchContinuation
    requested_changes: tuple[RequestedChange, ...] = ()
    synthetic_reference: VersionedReference
    sample_provenance: SampleProvenance
    source_evidence_ids: tuple[Text, ...] = Field(min_length=1)
    reference_kind: Literal['independent_synthetic'] = 'independent_synthetic'
    outcome_probabilities: ResearchReactionProbabilities | None = None
    continuation_probability: Unit | None = None
    generation_reason_codes: tuple[Text, ...] = ()

class ResearchObservation(Contract):
    schema_version: Literal[v.OBSERVATION_SCHEMA_VERSION] = v.OBSERVATION_SCHEMA_VERSION
    protocol_version: Literal[v.PROTOCOL_VERSION] = v.PROTOCOL_VERSION
    observation_id: Text
    profile_id: Text
    scenario_id: Text
    source_run_id: Text
    source_evidence_ids: tuple[Text, ...] = Field(min_length=1)
    predictor_input: PredictorInput
    post_reaction: AuthoritativeOutcome

class ResearchTrajectory(Contract):
    schema_version: Literal[v.TRAJECTORY_SCHEMA_VERSION] = v.TRAJECTORY_SCHEMA_VERSION
    profile_id: Text
    scenario_id: Text
    observations: tuple[ResearchObservation, ...] = Field(min_length=1)

    @model_validator(mode='after')
    def chronological(self):
        if any(((o.profile_id, o.scenario_id) != (self.profile_id, self.scenario_id) for o in self.observations)):
            raise ValueError('trajectory profile/scenario mismatch')
        keys = [o.predictor_input.position.key() for o in self.observations]
        if keys != sorted(set(keys)):
            raise ValueError('trajectory positions must be unique and increasing')
        if len({o.observation_id for o in self.observations}) != len(self.observations):
            raise ValueError('duplicate observation ID')
        return self

    def validate_scenario(self, scenario: ResearchScenario) -> None:
        if (self.profile_id, self.scenario_id) != (scenario.profile_id, scenario.scenario_id):
            raise ValueError('trajectory/scenario mismatch')
        for obs in self.observations:
            if not scenario.session_plan.contains(obs.predictor_input.position):
                raise ValueError('observation outside session plan')
            if obs.predictor_input.recommender_policy != scenario.recommender_policy:
                raise ValueError('observation policy mismatch')
            if obs.post_reaction.synthetic_reference != scenario.outcome_generator:
                raise ValueError('observation outcome generator mismatch')
            seed = obs.post_reaction.sample_provenance
            if (seed.root_seed, seed.simulation_seed_namespace) != (scenario.root_seed, scenario.simulation_seed_namespace):
                raise ValueError('observation seed provenance mismatch')
            item = obs.predictor_input.action.selected_item
            if item is not None and item.dataset != scenario.dataset:
                raise ValueError('selected-item dataset mismatch')
