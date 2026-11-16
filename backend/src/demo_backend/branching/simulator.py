from __future__ import annotations
from demo_backend.ports.recommendation import RecommendationContext
from demo_backend.domain.research import RecommenderAction
from demo_backend.domain.research import SelectedItem
from demo_backend.catalog.windows import candidate_recipes
from demo_backend.domain.versions import CANDIDATE_SELECTION_VERSION
from demo_backend.branching.engine import _dynamic_state
from demo_backend.branching.engine import _position_ordinal
from demo_backend.branching.engine import BranchSimulator
from demo_backend.safety.gate import safe_context

def context_for(root, snapshot, position):
    recipes = candidate_recipes(root.recipes, profile_id=root.profile.profile_id, dataset_fingerprint=root.scenario.dataset.fingerprint or root.scenario.dataset.identifier, ordinal=_position_ordinal(position, root))
    return safe_context(RecommendationContext(persona=root.persona_copy(), state=_dynamic_state(snapshot.state), recipes=recipes, turn_index=position.turn_index, memory_context={'observable_history': tuple(snapshot.history), 'recent_recipe_ids': list(snapshot.recent_recipe_ids), 'accepted_recipe_ids': list(snapshot.accepted_recipe_ids), 'rejected_recipe_ids': list(snapshot.rejected_recipe_ids), 'recent_preference_feedback': list(snapshot.recent_preference_feedback), 'prior_observation_count': len(snapshot.history), 'current_request': root.scenario.initial_context.request, 'session_index': position.session_index}))

class StudyBranchSimulator(BranchSimulator):
    """Use the same V3 upstream hard gate for every policy, retaining V2 math."""

    def __init__(self, resolver):
        super().__init__()
        self.resolve = resolver

    def recommend(self, root, snapshot, policy_identity, position, *, action_suffix):
        context = context_for(root, snapshot, position)
        output = self.resolve(*policy_identity).recommend(context)
        recipe = next((r for r in context.recipes if r.recipe_id == output.selected_recipe_id))
        action = RecommenderAction(action_id=f'{root.root_context_id}:{action_suffix}:{policy_identity[0]}:action', action_type='recommend_recipe', selected_item=SelectedItem(item_id=recipe.recipe_id, title=recipe.title, ingredients=tuple(recipe.ingredients), dataset=root.scenario.dataset, known_constraints=tuple(output.constraint_violations)), explanation=output.rationale, grounding=(f'policy:{policy_identity[0]}@{policy_identity[1]}', f'candidate_selection:{CANDIDATE_SELECTION_VERSION}', 'v3_safe_context_all_policies'))
        return (action, recipe)
