from __future__ import annotations
from demo_backend.recommendation.deterministic import _constraint_violations
from demo_backend.recommendation.deterministic import recommend_recipe
from demo_backend.domain.platform import RecommendationAgentOutput
from demo_backend.safety.attributes import structured_recipe_constraint_evidence
from demo_backend.ports.recommendation import RecommendationContext

DEFAULT_RECOMMENDATION_POLICY_ID = 'deterministic_recipe_recommendation'

DEFAULT_RECOMMENDATION_POLICY_VERSION = '1'

CONSTRAINT_ONLY_POLICY_ID = 'constraint_only_baseline'

CONSTRAINT_ONLY_POLICY_VERSION = '1'

class DeterministicRecommendationPolicy:
    """Lossless adapter around the existing authoritative recommender."""
    policy_id = DEFAULT_RECOMMENDATION_POLICY_ID
    policy_version = DEFAULT_RECOMMENDATION_POLICY_VERSION
    deterministic = True

    def recommend(self, context: RecommendationContext) -> RecommendationAgentOutput:
        return recommend_recipe(persona=context.persona, state=context.state, recipes=list(context.recipes), turn_index=context.turn_index, memory_context=dict(context.memory_context))

class ConstraintOnlyBaselinePolicy:
    """Transparent infrastructure baseline; no superiority claim is implied."""
    policy_id = CONSTRAINT_ONLY_POLICY_ID
    policy_version = CONSTRAINT_ONLY_POLICY_VERSION
    deterministic = True

    def recommend(self, context: RecommendationContext) -> RecommendationAgentOutput:
        if not context.recipes:
            raise ValueError('constraint_only_baseline requires at least one recipe')
        candidates = [(_constraint_violations(context.persona, recipe), recipe) for recipe in context.recipes]
        valid = [item for item in candidates if not item[0]]
        pool = valid or candidates
        ranked = sorted(pool, key=lambda item: (len(item[0]), item[1].recipe_id))
        violations, selected = ranked[0]
        return RecommendationAgentOutput(turn_index=context.turn_index, selected_recipe_id=selected.recipe_id, ranked_recipe_ids=[recipe.recipe_id for _, recipe in ranked], rationale='Selected the lexicographically first hard-constraint-compatible recipe using constraint_only_baseline_v1. This policy is an infrastructure control and makes no scientific superiority claim.', constraint_violations=violations, constraint_evidence=structured_recipe_constraint_evidence(context.persona, selected))
