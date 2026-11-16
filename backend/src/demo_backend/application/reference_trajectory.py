from __future__ import annotations
from typing import Literal
from demo_backend.ports.recommendation import RecommendationContext
from demo_backend.domain.research import Position
from demo_backend.domain.research import RecommenderAction
from demo_backend.domain.research import SelectedItem
from demo_backend.domain.research import PredictorInput
from demo_backend.domain.research import ResearchObservation
from demo_backend.domain.research import HistoryEntry
from demo_backend.domain.research import ResearchTrajectory
from demo_backend.simulation.structured import PCUBOutcomeContext
from demo_backend.simulation.transition import PCUBSyntheticStateTransition
from demo_backend.simulation.profile_adapter import _persona
from demo_backend.simulation.profile_adapter import _dynamic_state
from demo_backend.simulation.profile_adapter import _state_features
from demo_backend.catalog.windows import candidate_recipes
from demo_backend.simulation.trajectory_contract import V2Trajectory
from demo_backend.recommendation.feedback import NoSafeRecommendation
from demo_backend.safety.gate import safe_context

class V3Trajectory(V2Trajectory):
    version: Literal['pcub_v3_trajectory_v1'] = 'pcub_v3_trajectory_v1'

def generate_trajectory(profile, scenario, recipes, *, outcome_generator, no_safe_events, resolver):
    scenario.validate_profile(profile)
    persona = _persona(profile)
    state = profile.initial_state.model_copy(deep=True)
    policy = resolver(scenario.recommender_policy.identifier, scenario.recommender_policy.version)
    history = []
    observations = []
    recent = []
    accepted = []
    rejected = []
    feedback = []
    transition = PCUBSyntheticStateTransition()
    for ordinal in range(scenario.session_plan.number_of_sessions * scenario.session_plan.turns_per_session):
        session = ordinal // scenario.session_plan.turns_per_session + 1
        turn = ordinal % scenario.session_plan.turns_per_session + 1
        position = Position(session_index=session, turn_index=turn)
        candidates = candidate_recipes(recipes, profile_id=profile.profile_id, dataset_fingerprint=scenario.dataset.fingerprint or scenario.dataset.identifier, ordinal=ordinal + 1)
        context = RecommendationContext(persona=persona, state=_dynamic_state(state), recipes=candidates, turn_index=turn, memory_context={'observable_history': tuple(history), 'recent_recipe_ids': list(recent), 'accepted_recipe_ids': list(accepted), 'rejected_recipe_ids': list(rejected), 'prior_observation_count': len(history), 'recent_preference_feedback': list(feedback), 'session_index': session, 'current_request': scenario.initial_context.request})
        try:
            context = safe_context(context)
            recommendation = policy.recommend(context)
        except NoSafeRecommendation:
            no_safe_events.append({'scenario_id': scenario.scenario_id, 'profile_id': profile.profile_id, 'position': position.model_dump(mode='json'), 'reason': 'NO_SAFE_RECOMMENDATION', 'observed_turns': len(observations)})
            break
        recipe = next((r for r in candidates if r.recipe_id == recommendation.selected_recipe_id))
        observation_id = f'{scenario.scenario_id}:s{session:02d}:t{turn:02d}'
        action = RecommenderAction(action_id=observation_id + ':action', action_type='recommend_recipe', selected_item=SelectedItem(item_id=recipe.recipe_id, title=recipe.title, ingredients=tuple(recipe.ingredients), dataset=scenario.dataset, known_constraints=tuple(recommendation.constraint_violations)), explanation=recommendation.rationale, grounding=(f'policy:{scenario.recommender_policy.identifier}@1', 'v3_observable_history_request_position'))
        source = f'profile:{profile.profile_id}:initial_state' if not history else history[-1].source_evidence_ids[0]
        inp = PredictorInput(position=position, action=action, recommender_policy=scenario.recommender_policy, profile_features=profile.characteristics, context=scenario.initial_context, history=tuple(history), features=_state_features(state, position, source))
        outcome = outcome_generator.generate(PCUBOutcomeContext(profile, scenario, position, recipe, tuple(recommendation.constraint_violations), state, tuple(history), tuple(recent)))
        observations.append(ResearchObservation(observation_id=observation_id, profile_id=profile.profile_id, scenario_id=scenario.scenario_id, source_run_id='pcub-v3:' + scenario.scenario_id, source_evidence_ids=(action.action_id, *outcome.source_evidence_ids), predictor_input=inp, post_reaction=outcome))
        history.append(HistoryEntry(position=position, action=action, reaction=outcome.reaction, continuation=outcome.continuation, requested_changes=outcome.requested_changes, source_evidence_ids=outcome.source_evidence_ids))
        recent.append(recipe.recipe_id)
        if outcome.reaction.value == 'ACCEPT':
            accepted.append(recipe.recipe_id)
        if outcome.reaction.value == 'REJECT':
            rejected.append(recipe.recipe_id)
        feedback.extend(('requested_change:' + d.value for change in outcome.requested_changes for d in change.dimensions))
        state = transition.apply(state, outcome).state_after
    if observations:
        ResearchTrajectory(profile_id=profile.profile_id, scenario_id=scenario.scenario_id, observations=tuple(observations))
    return V3Trajectory(profile_id=profile.profile_id, scenario_id=scenario.scenario_id, observations=tuple(observations))
