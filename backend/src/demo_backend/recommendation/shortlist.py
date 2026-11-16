from __future__ import annotations
from demo_backend.recommendation.baselines import DeterministicRecommendationPolicy
from demo_backend.recommendation.feedback import FeedbackSequencePolicy
from demo_backend.safety.gate import safe_context

SHORTLIST_ID = 'v3_safe_shortlist@1'

def shortlist(context):
    safe = safe_context(context)
    feedback = FeedbackSequencePolicy().recommend(safe)
    deterministic = DeterministicRecommendationPolicy().recommend(safe)
    if len(safe.recipes) <= 10:
        ids = [r.recipe_id for r in safe.recipes]
    else:
        ids = []
        for recipe_id in [*feedback.ranked_recipe_ids[:5], *deterministic.ranked_recipe_ids[:5], *feedback.ranked_recipe_ids, *deterministic.ranked_recipe_ids]:
            if recipe_id not in ids:
                ids.append(recipe_id)
            if len(ids) == 10:
                break
    selected = set(ids)
    return (safe, tuple(sorted((r for r in safe.recipes if r.recipe_id in selected), key=lambda r: r.recipe_id)), feedback)
