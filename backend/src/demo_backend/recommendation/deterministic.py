from __future__ import annotations
from demo_backend.domain.platform import DynamicUserState
from demo_backend.domain.platform import RecipeItem
from demo_backend.domain.platform import RecommendationAgentOutput
from demo_backend.domain.platform import UserPersona
from demo_backend.catalog.health import normalized_health_score
from demo_backend.safety.attributes import recipe_attribute_summary
from demo_backend.safety.attributes import structured_recipe_constraint_evidence
from demo_backend.safety.attributes import structured_recipe_constraint_reasons

MEAT_TERMS = {'beef', 'pork', 'chicken', 'turkey', 'lamb', 'bacon', 'ham', 'sausage', 'meat', 'meatball', 'prosciutto', 'pepperoni'}

FISH_SHELLFISH_TERMS = {'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'crab', 'lobster', 'shellfish', 'anchovy', 'sardine'}

DAIRY_EGG_HONEY_TERMS = {'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'egg', 'eggs', 'honey', 'whey', 'casein'}

VEGETARIAN_BLOCKED_TERMS = MEAT_TERMS | FISH_SHELLFISH_TERMS

VEGAN_BLOCKED_TERMS = VEGETARIAN_BLOCKED_TERMS | DAIRY_EGG_HONEY_TERMS

SODIUM_EXTREME_THRESHOLD_MG = 800.0

def recommend_recipe(persona: UserPersona, state: DynamicUserState, recipes: list[RecipeItem], turn_index: int, memory_context: dict | None=None) -> RecommendationAgentOutput:
    """Choose a deterministic recommendation from candidate recipes."""
    if not recipes:
        raise ValueError('recommend_recipe requires at least one recipe')
    recent_recipe_ids = set((memory_context or {}).get('recent_recipe_ids', []))
    scored = [(_constraint_violations(persona, recipe), _score_recipe(persona, state, recipe, recent_recipe_ids), recipe) for recipe in recipes]
    valid_candidates = [item for item in scored if not item[0]]
    candidate_pool = valid_candidates or scored
    ranked = sorted(candidate_pool, key=lambda item: (len(item[0]), -item[1], item[2].recipe_id))
    selected_violations, selected_score, selected_recipe = ranked[0]
    ranked_recipe_ids = [recipe.recipe_id for _, _, recipe in ranked]
    return RecommendationAgentOutput(turn_index=turn_index, selected_recipe_id=selected_recipe.recipe_id, ranked_recipe_ids=ranked_recipe_ids, rationale=_build_rationale(selected_recipe, selected_score, bool(valid_candidates), selected_violations), constraint_violations=selected_violations, constraint_evidence=structured_recipe_constraint_evidence(persona, selected_recipe))

def _score_recipe(persona: UserPersona, state: DynamicUserState, recipe: RecipeItem, recent_recipe_ids: set[str]) -> float:
    score = 0.0
    score += (normalized_health_score(recipe) or 0.0) * 100.0
    score += min(recipe.protein_per_serving_g or 0.0, 60.0) * 0.25
    if recipe.sodium_per_serving_mg is not None:
        score -= max(0.0, recipe.sodium_per_serving_mg - SODIUM_EXTREME_THRESHOLD_MG) * 0.02
    score += _taste_preference_score(persona, recipe) * 5.0
    if recipe.recipe_id in recent_recipe_ids:
        score -= 20.0
    return score

def _constraint_violations(persona: UserPersona, recipe: RecipeItem) -> list[str]:
    violations: list[str] = []
    terms = _recipe_terms(recipe)
    if persona.dietary_pattern == 'vegetarian':
        blocked = _matching_terms(terms, VEGETARIAN_BLOCKED_TERMS)
        violations.extend((f'vegetarian_blocked:{term}' for term in blocked))
    elif persona.dietary_pattern == 'vegan':
        blocked = _matching_terms(terms, VEGAN_BLOCKED_TERMS)
        violations.extend((f'vegan_blocked:{term}' for term in blocked))
    for allergy in persona.allergies:
        if _contains_term(terms, allergy):
            violations.append(f'allergy:{allergy}')
    for excluded in persona.excluded_ingredients:
        if _contains_term(terms, excluded):
            violations.append(f'excluded_ingredient:{excluded}')
    violations.extend(structured_recipe_constraint_reasons(persona, recipe))
    return sorted(set(violations))

def _taste_preference_score(persona: UserPersona, recipe: RecipeItem) -> int:
    searchable = _recipe_search_text(recipe)
    return sum((1 for preference in persona.taste_preferences if _contains_text(searchable, preference)))

def _recipe_terms(recipe: RecipeItem) -> list[str]:
    values = [recipe.title, *recipe.ingredients, *recipe.tags, *recipe.dietary_labels, *recipe.allergens]
    return [_normalize(value) for value in values if _normalize(value)]

def _recipe_search_text(recipe: RecipeItem) -> str:
    return ' '.join(_recipe_terms(recipe))

def _matching_terms(recipe_terms: list[str], blocked_terms: set[str]) -> list[str]:
    return sorted((term for term in blocked_terms if _contains_term(recipe_terms, term)))

def _contains_term(recipe_terms: list[str], target: str) -> bool:
    normalized_target = _normalize(target)
    if not normalized_target:
        return False
    return any((_contains_text(term, normalized_target) for term in recipe_terms))

def _contains_text(text: str, target: str) -> bool:
    normalized_target = _normalize(target)
    return normalized_target in _normalize(text).split()

def _normalize(value: str) -> str:
    cleaned = ''.join((char.lower() if char.isalnum() else ' ' for char in str(value)))
    return ' '.join(cleaned.split())

def _build_rationale(recipe: RecipeItem, score: float, used_valid_pool: bool, constraint_violations: list[str]) -> str:
    pool_note = 'valid candidate' if used_valid_pool else 'constraint-relaxed least-bad fallback candidate'
    rationale = f'Selected {recipe.title} as the top {pool_note} using deterministic normalized health, protein, sodium, taste, and repetition scoring. Score={score:.2f}.'
    attribute_summary = recipe_attribute_summary(recipe)
    if attribute_summary:
        rationale = f'{rationale} {attribute_summary}'
    if constraint_violations:
        rationale = f"{rationale} Constraint issues: {', '.join(constraint_violations)}."
    return rationale
