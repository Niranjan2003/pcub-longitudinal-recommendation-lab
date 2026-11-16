from __future__ import annotations
from dataclasses import dataclass
from typing import Literal
from demo_backend.domain.ontology import ResearchReaction as R
from demo_backend.domain.ontology import ResearchContinuation as C
from demo_backend.domain.ontology import ChangeDimension
from demo_backend.domain.research import AuthoritativeOutcome
from demo_backend.domain.research import RequestedChange
from demo_backend.domain.research import VersionedReference
from demo_backend.domain.research import SampleProvenance
from demo_backend.domain.research import ResearchReactionProbabilities
from demo_backend.simulation.structured import PCUBSyntheticOutcomeGenerator
from demo_backend.catalog.health import normalized_health_score
from demo_backend.recommendation.feedback import effort

@dataclass(frozen=True)
class ExternalAction:
    intent: str
    about_current_recommendation: bool = False
    explicit_decision: Literal['accept', 'reject', 'defer'] | None = None
    requested_dimension: str | None = None

@dataclass(frozen=True)
class MappedAction:
    status: str
    reaction: R | None
    continuation: C | None
    requested_changes: tuple = ()

def map_action(action: ExternalAction):
    if action.intent == 'STOP':
        return MappedAction('CONTINUATION_ONLY', None, C.DISENGAGE)
    if action.explicit_decision and action.about_current_recommendation:
        return MappedAction('MAPPED', {'accept': R.ACCEPT, 'reject': R.REJECT, 'defer': R.DEFER}[action.explicit_decision], C.CONTINUE)
    if action.intent in {'INQUIRE', 'REQUEST'} and action.about_current_recommendation:
        changes = () if action.requested_dimension is None else (RequestedChange(dimensions=(ChangeDimension(action.requested_dimension),), instruction='Please revise ' + action.requested_dimension),)
        return MappedAction('MAPPED', R.MODIFY_CLARIFY, C.CONTINUE, changes)
    if action.intent in {'LIKE', 'DISLIKE', 'NEUTRAL', 'YES', 'NO', 'ITEM_CONSUMED', 'INFORM', 'DISCLOSE', 'DONT_KNOW'}:
        return MappedAction('AMBIGUOUS', None, None)
    return MappedAction('UNSUPPORTED', None, None)

class AgendaDerivedSimulator:
    """Source-inspired preference/agenda adapter, not official full simulation.

The official Agenda was separately executed. Food goals and commitment realization
below are our versioned adaptation; hidden profile values stay in this outcome API.
"""
    backend_id = 'usersimcrs_agenda_derived@1'

    def action(self, context):
        if context.constraint_violations:
            return ExternalAction('DISLIKE', True, 'reject')
        recipe = context.selected_recipe
        goals = context.profile.tendencies
        consumed = any((h.reaction == R.ACCEPT and h.action.selected_item and (h.action.selected_item.item_id == recipe.recipe_id) for h in context.history))
        if consumed and goals.novelty_preference > 0.5:
            return ExternalAction('REQUEST', True, requested_dimension='novelty')
        health = float(normalized_health_score(recipe) or 0)
        searchable = ' '.join([recipe.title, *recipe.ingredients]).lower()
        prefs = context.profile.characteristics.taste_preferences
        taste = sum((x.lower() in searchable for x in prefs)) / max(1, len(prefs))
        preference = 2 * ((goals.health_priority * health + goals.taste_priority * taste + (1 - effort(recipe))) / (goals.health_priority + goals.taste_priority + 1)) - 1
        if preference > 0.25:
            return ExternalAction('LIKE', True, 'accept')
        if preference < -0.25:
            return ExternalAction('DISLIKE', True, 'reject')
        dimension = 'effort' if effort(recipe) > goals.preparation_effort_tolerance else 'health'
        return ExternalAction('INQUIRE', True, requested_dimension=dimension)

    def generate(self, context):
        action = self.action(context)
        mapped = map_action(action)
        if mapped.status != 'MAPPED':
            raise ValueError('Ambiguous external action cannot become authoritative outcome')
        reaction = mapped.reaction
        return AuthoritativeOutcome(reaction=reaction, continuation=mapped.continuation, requested_changes=mapped.requested_changes, synthetic_reference=VersionedReference(identifier='usersimcrs_agenda_derived', version='1'), sample_provenance=SampleProvenance(root_seed=context.scenario.root_seed, simulation_seed_namespace=context.scenario.simulation_seed_namespace, seed_derivation_version='deterministic_agenda_v1'), source_evidence_ids=(f'{context.scenario.scenario_id}:{context.position.session_index}:{context.position.turn_index}:agenda-outcome',), outcome_probabilities=ResearchReactionProbabilities(**{r.value: float(r == reaction) for r in R}), generation_reason_codes=('food_preference_realization_adaptation', action.intent))

def resolve_backend(identity):
    if identity == 'current_structured_simulator@1':
        return PCUBSyntheticOutcomeGenerator()
    if identity == 'usersimcrs_agenda_derived@1':
        return AgendaDerivedSimulator()
    raise ValueError('Unknown outcome backend')
