from __future__ import annotations
from typing import Any
from demo_backend.domain.platform import RecipeItem

CONSTRAINT_FIELD_NAMES = ('max_total_time_minutes', 'max_ingredient_count', 'max_instruction_count', 'min_servings', 'max_servings')

def has_recipe_constraints(source: Any) -> bool:
    """Return whether a constraint source requests any structured recipe limits."""
    return any((getattr(source, field_name, None) is not None for field_name in CONSTRAINT_FIELD_NAMES))

def structured_recipe_constraint_reasons(source: Any, recipe: RecipeItem) -> list[str]:
    """Return explicit missing-data or threshold-violation reasons for a recipe."""
    evidence = structured_recipe_constraint_evidence(source, recipe)
    reasons: list[str] = []
    seen: set[str] = set()
    for status in evidence.values():
        if status == 'satisfied' or status in seen:
            continue
        reasons.append(status)
        seen.add(status)
    return reasons

def structured_recipe_constraint_evidence(source: Any, recipe: RecipeItem) -> dict[str, str]:
    """Evaluate requested hard constraints against available recipe metadata."""
    evidence: dict[str, str] = {}
    max_time = getattr(source, 'max_total_time_minutes', None)
    if max_time is not None:
        evidence['total_time_minutes'] = _max_status(value=recipe.total_time_minutes, maximum=float(max_time), missing_reason='missing_total_time', violation_reason='exceeds_total_time')
    max_ingredients = getattr(source, 'max_ingredient_count', None)
    if max_ingredients is not None:
        evidence['ingredient_count'] = _max_status(value=recipe.ingredient_count, maximum=int(max_ingredients), missing_reason='missing_ingredient_count', violation_reason='exceeds_ingredient_count')
    max_instructions = getattr(source, 'max_instruction_count', None)
    if max_instructions is not None:
        evidence['instruction_count'] = _max_status(value=recipe.instruction_count, maximum=int(max_instructions), missing_reason='missing_instruction_count', violation_reason='exceeds_instruction_count')
    min_servings = getattr(source, 'min_servings', None)
    if min_servings is not None:
        evidence['min_servings'] = _min_status(value=recipe.servings, minimum=float(min_servings), missing_reason='missing_servings', violation_reason='below_min_servings')
    max_servings = getattr(source, 'max_servings', None)
    if max_servings is not None:
        evidence['max_servings'] = _max_status(value=recipe.servings, maximum=float(max_servings), missing_reason='missing_servings', violation_reason='exceeds_max_servings')
    return evidence

def recipe_attribute_summary(recipe: RecipeItem) -> str:
    """Return a factual compact summary of present time and complexity fields."""
    parts: list[str] = []
    if recipe.total_time_minutes is not None:
        parts.append(f'ready in {_format_number(recipe.total_time_minutes)} minutes')
    if recipe.ingredient_count is not None:
        parts.append(f'{recipe.ingredient_count} ingredients')
    if recipe.instruction_count is not None:
        parts.append(f'{recipe.instruction_count} steps')
    if recipe.servings is not None:
        parts.append(f'serves {_format_number(recipe.servings)}')
    if not parts:
        return ''
    return ', '.join(parts).capitalize() + '.'

def _max_status(*, value: float | int | None, maximum: float, missing_reason: str, violation_reason: str) -> str:
    if value is None:
        return missing_reason
    if float(value) > maximum:
        return violation_reason
    return 'satisfied'

def _min_status(*, value: float | int | None, minimum: float, missing_reason: str, violation_reason: str) -> str:
    if value is None:
        return missing_reason
    if float(value) < minimum:
        return violation_reason
    return 'satisfied'

def _format_number(value: float) -> str:
    numeric = float(value)
    if numeric.is_integer():
        return str(int(numeric))
    return f'{numeric:.1f}'.rstrip('0').rstrip('.')
