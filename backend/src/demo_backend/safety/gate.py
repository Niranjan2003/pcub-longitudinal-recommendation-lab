from __future__ import annotations
from dataclasses import replace
from demo_backend.recommendation.deterministic import _constraint_violations
from demo_backend.recommendation.feedback import NoSafeRecommendation

def safe_context(context):
    extra = context.memory_context.get('hard_excluded_ingredients', ())
    persona = context.persona.model_copy(update={'excluded_ingredients': list(dict.fromkeys([*context.persona.excluded_ingredients, *extra]))})
    if len({r.recipe_id for r in context.recipes}) != len(context.recipes):
        raise ValueError('Candidate recipe IDs must be unique')
    recipes = tuple((r for r in context.recipes if not _constraint_violations(persona, r) and (r.ingredients or not (persona.allergies or persona.excluded_ingredients or persona.dietary_pattern != 'omnivore'))))
    if not recipes:
        raise NoSafeRecommendation('V3 no verified hard-constraint-compatible candidate')
    return replace(context, persona=persona, recipes=recipes)
