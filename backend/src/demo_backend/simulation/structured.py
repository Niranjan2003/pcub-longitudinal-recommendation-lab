from __future__ import annotations
import random
from dataclasses import dataclass
from demo_backend.domain.platform import RecipeItem
from demo_backend.catalog.health import normalized_health_score
from demo_backend.simulation.numeric import stable_sigmoid
from demo_backend.simulation.numeric import stable_softmax
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.ontology import ChangeDimension
from demo_backend.domain.ontology import ResearchContinuation
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.simulation.archetypes import profile_archetype
from demo_backend.domain.research import AuthoritativeOutcome
from demo_backend.domain.research import HistoryEntry
from demo_backend.domain.research import Position
from demo_backend.domain.research import RequestedChange
from demo_backend.domain.research import ResearchInitialState
from demo_backend.domain.research import ResearchReactionProbabilities
from demo_backend.domain.research import ResearchScenario
from demo_backend.domain.research import SampleProvenance
from demo_backend.domain.research import SimulatedResearchProfile
from demo_backend.domain.seeds import stable_seed
from demo_backend.domain.versions import OUTCOME_GENERATOR_ID
from demo_backend.domain.versions import OUTCOME_GENERATOR_VERSION
from demo_backend.domain.versions import SEED_DERIVATION_VERSION

@dataclass(frozen=True)
class PCUBOutcomeContext:
    """Private simulator context. It deliberately has no forecast field."""
    profile: SimulatedResearchProfile
    scenario: ResearchScenario
    position: Position
    selected_recipe: RecipeItem
    constraint_violations: tuple[str, ...]
    state_before: ResearchInitialState
    history: tuple[HistoryEntry, ...]
    recent_recipe_ids: tuple[str, ...]

@dataclass(frozen=True)
class OutcomeFeatures:
    health_fit: float
    taste_fit: float
    effort_mismatch: float
    budget_mismatch: float
    constraint_conflict: float
    repetition: float
    novelty: float
    unresolved_request: float
    prior_reject_rate: float
    progress: float
    overall_fit: float
    uncertainty: float

_ARCHETYPE_BIASES: dict[str, dict[ResearchReaction, float]] = {'health_oriented': {ResearchReaction.ACCEPT: 0.08, ResearchReaction.MODIFY_CLARIFY: 0.06}, 'taste_oriented': {ResearchReaction.ACCEPT: 0.04, ResearchReaction.MODIFY_CLARIFY: 0.1}, 'convenience_sensitive': {ResearchReaction.MODIFY_CLARIFY: 0.12, ResearchReaction.DEFER: 0.08}, 'novelty_seeking': {ResearchReaction.ACCEPT: 0.06, ResearchReaction.REJECT: -0.04}, 'budget_sensitive': {ResearchReaction.MODIFY_CLARIFY: 0.1, ResearchReaction.DEFER: 0.05}, 'constraint_sensitive': {ResearchReaction.REJECT: 0.1, ResearchReaction.MODIFY_CLARIFY: 0.08}, 'balanced': {}}

def _tokens(recipe: RecipeItem) -> set[str]:
    text = ' '.join((recipe.title, *recipe.ingredients, *recipe.tags, *recipe.dietary_labels))
    cleaned = ''.join((char.casefold() if char.isalnum() else ' ' for char in text))
    return set(cleaned.split())

def _match_rate(preferences: tuple[str, ...], recipe: RecipeItem) -> float:
    if not preferences:
        return 0.5
    searchable = ' '.join(sorted(_tokens(recipe)))
    matched = sum((1 for preference in preferences if preference.casefold() in searchable))
    return matched / len(preferences)

def _features(context: PCUBOutcomeContext) -> OutcomeFeatures:
    profile = context.profile
    tendencies = profile.tendencies
    recipe = context.selected_recipe
    health_fit = float(normalized_health_score(recipe) or 0.5)
    taste_fit = _match_rate(profile.characteristics.taste_preferences, recipe)
    time_minutes = float(recipe.total_time_minutes or 35.0)
    tolerated_minutes = 15.0 + 45.0 * tendencies.preparation_effort_tolerance
    effort_mismatch = max(0.0, min(1.0, (time_minutes - tolerated_minutes) / max(tolerated_minutes, 1.0)))
    ingredient_count = float(recipe.ingredient_count or len(recipe.ingredients))
    budget_mismatch = max(0.0, min(1.0, (ingredient_count - 8.0) / 16.0)) * tendencies.budget_sensitivity
    constraint_conflict = min(len(context.constraint_violations) / 2.0, 1.0)
    repetition = float(recipe.recipe_id in context.recent_recipe_ids)
    unresolved_request = float(bool(context.history and context.history[-1].requested_changes))
    prior_reject_rate = sum((entry.reaction == ResearchReaction.REJECT for entry in context.history)) / len(context.history) if context.history else 0.0
    total_turns = context.scenario.session_plan.number_of_sessions * context.scenario.session_plan.turns_per_session
    ordinal = (context.position.session_index - 1) * context.scenario.session_plan.turns_per_session + context.position.turn_index
    progress = (ordinal - 1) / max(total_turns - 1, 1)
    weights = (tendencies.health_priority, tendencies.taste_priority, 0.65, 0.45)
    components = (health_fit, taste_fit, 1.0 - effort_mismatch, 1.0 - budget_mismatch)
    overall_fit = sum((weight * value for weight, value in zip(weights, components))) / sum(weights)
    uncertainty = max(0.0, 1.0 - abs(overall_fit - 0.5) * 2.0)
    return OutcomeFeatures(health_fit=health_fit, taste_fit=taste_fit, effort_mismatch=effort_mismatch, budget_mismatch=budget_mismatch, constraint_conflict=constraint_conflict, repetition=repetition, novelty=1.0 - repetition, unresolved_request=unresolved_request, prior_reject_rate=prior_reject_rate, progress=progress, overall_fit=overall_fit, uncertainty=uncertainty)

def _utilities(context: PCUBOutcomeContext, features: OutcomeFeatures) -> dict[str, float]:
    state = context.state_before
    t = context.profile.tendencies
    f = features
    utilities = {ResearchReaction.ACCEPT: 0.05 + 1.55 * f.overall_fit + 0.5 * state.motivation + 0.3 * state.trust - 1.75 * f.constraint_conflict * t.constraint_sensitivity - 0.85 * f.effort_mismatch - 0.55 * f.budget_mismatch - 0.45 * f.repetition - 0.45 * state.fatigue - 0.45 * state.resistance, ResearchReaction.MODIFY_CLARIFY: -0.05 + 0.65 * state.engagement + 0.85 * (1.0 - f.overall_fit) + 0.75 * f.effort_mismatch + 0.55 * f.budget_mismatch + 0.55 * (1.0 - f.taste_fit) + 0.65 * f.unresolved_request + 0.35 * f.constraint_conflict, ResearchReaction.DEFER: -0.15 + 1.0 * f.uncertainty + 0.9 * state.fatigue + 0.55 * f.progress + 0.45 * f.unresolved_request + 0.25 * f.repetition - 0.3 * state.engagement - 0.25 * f.constraint_conflict, ResearchReaction.REJECT: -0.75 + 2.1 * f.constraint_conflict * t.constraint_sensitivity + 1.0 * state.resistance + 0.75 * (1.0 - f.overall_fit) + 0.65 * f.prior_reject_rate + 0.4 * f.effort_mismatch + 0.3 * f.budget_mismatch - 0.25 * state.engagement}
    for reaction, adjustment in _ARCHETYPE_BIASES[profile_archetype(context.profile)].items():
        utilities[reaction] += adjustment
    return {reaction.value: round(value, 8) for reaction, value in utilities.items()}

def _sample(probabilities: dict[str, float], draw: float) -> ResearchReaction:
    cumulative = 0.0
    for reaction in RESEARCH_REACTION_ORDER:
        cumulative += probabilities[reaction.value]
        if draw < cumulative:
            return reaction
    return RESEARCH_REACTION_ORDER[-1]

def _requested_changes(context: PCUBOutcomeContext, features: OutcomeFeatures) -> tuple[RequestedChange, ...]:
    dimensions: list[ChangeDimension] = []
    violations = ' '.join(context.constraint_violations)
    if 'allergy:' in violations or 'excluded_ingredient:' in violations or 'blocked:' in violations:
        dimensions.append(ChangeDimension.INGREDIENT)
    if features.health_fit < 0.48 and context.profile.tendencies.health_priority >= 0.55:
        dimensions.append(ChangeDimension.HEALTH)
    if features.taste_fit < 0.5:
        dimensions.append(ChangeDimension.TASTE)
    if features.budget_mismatch >= 0.2:
        dimensions.append(ChangeDimension.COST)
    if features.effort_mismatch >= 0.15 or 'instruction' in violations:
        dimensions.append(ChangeDimension.EFFORT)
    if features.repetition:
        dimensions.append(ChangeDimension.NOVELTY)
    if 'serving' in violations:
        dimensions.append(ChangeDimension.PORTION)
    if 'total_time' in violations:
        dimensions.append(ChangeDimension.TIMING)
    dimensions = list(dict.fromkeys(dimensions))
    if dimensions:
        labels = ', '.join((dimension.value for dimension in dimensions))
        return (RequestedChange(dimensions=tuple(dimensions), instruction=f'Please adjust: {labels}.'),)
    return (RequestedChange(residual_text='Please clarify why this recommendation fits.'),)

class PCUBSyntheticOutcomeGenerator:
    """Independent reference policy with coefficients distinct from the v0.2 UBPA."""
    generator_id = OUTCOME_GENERATOR_ID
    generator_version = OUTCOME_GENERATOR_VERSION
    temperature = 0.92

    def generate(self, context: PCUBOutcomeContext) -> AuthoritativeOutcome:
        if context.profile.outcome_mechanism.identifier != self.generator_id:
            raise ValueError('profile outcome mechanism does not match generator')
        if context.scenario.outcome_generator != context.profile.outcome_mechanism:
            raise ValueError('scenario/profile outcome mechanism mismatch')
        features = _features(context)
        utilities = _utilities(context, features)
        probabilities = stable_softmax(utilities, tuple((reaction.value for reaction in RESEARCH_REACTION_ORDER)), temperature=self.temperature)
        derived_seed = stable_seed(context.scenario.root_seed, context.scenario.simulation_seed_namespace, context.profile.profile_id, context.scenario.scenario_id, context.position.session_index, context.position.turn_index, self.generator_id, self.generator_version, SEED_DERIVATION_VERSION)
        rng = random.Random(derived_seed)
        reaction_draw = rng.random()
        continuation_draw = rng.random()
        reaction = _sample(probabilities, reaction_draw)
        reaction_adjustment = {ResearchReaction.ACCEPT: 0.2, ResearchReaction.MODIFY_CLARIFY: 0.28, ResearchReaction.DEFER: -0.1, ResearchReaction.REJECT: -0.45}[reaction]
        continuation_probability = stable_sigmoid(0.75 + 0.6 * context.state_before.engagement + 0.35 * context.state_before.trust - 0.85 * context.state_before.fatigue - 0.7 * context.state_before.resistance - 0.45 * features.progress + reaction_adjustment)
        continuation = ResearchContinuation.CONTINUE if continuation_draw < continuation_probability else ResearchContinuation.DISENGAGE
        changes = _requested_changes(context, features) if reaction == ResearchReaction.MODIFY_CLARIFY else ()
        reason_codes = [f'synthetic_reaction:{reaction.value}']
        if features.constraint_conflict:
            reason_codes.append('constraint_conflict')
        if features.effort_mismatch >= 0.15:
            reason_codes.append('effort_mismatch')
        if features.repetition:
            reason_codes.append('exact_repetition')
        if features.unresolved_request:
            reason_codes.append('unresolved_prior_request')
        return AuthoritativeOutcome(reaction=reaction, continuation=continuation, requested_changes=changes, synthetic_reference=context.profile.outcome_mechanism, sample_provenance=SampleProvenance(root_seed=context.scenario.root_seed, simulation_seed_namespace=context.scenario.simulation_seed_namespace, seed_derivation_version=SEED_DERIVATION_VERSION, derived_seed=derived_seed, reaction_draw=reaction_draw, continuation_draw=continuation_draw), source_evidence_ids=(f'pcub-synthetic:{context.scenario.scenario_id}:s{context.position.session_index:02d}:t{context.position.turn_index:02d}',), outcome_probabilities=ResearchReactionProbabilities(**probabilities), continuation_probability=continuation_probability, generation_reason_codes=tuple(reason_codes))

__all__ = ['OutcomeFeatures', 'PCUBOutcomeContext', 'PCUBSyntheticOutcomeGenerator']
