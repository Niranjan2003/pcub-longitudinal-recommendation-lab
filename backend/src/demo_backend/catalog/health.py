from __future__ import annotations
import math
from demo_backend.domain.platform import RecipeItem

def normalized_health_score(recipe: RecipeItem) -> float | None:
    """Return a non-mutating 0-1 health score for ranking and behavior logic.

    HUMMUS compatibility scores are already stored on a normalized 0-1 scale.
    Known legacy workbook scores use the observed 1-10 scale, while sub-unit
    fallback scores remain accepted for old tests and synthetic recipes.
    Unknown provenance follows a compatibility rule: 0-1 is normalized, and
    values greater than 1 up to 10 are divided by 10.
    """
    if recipe.health_score is None:
        return None
    try:
        value = float(recipe.health_score)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    dataset_name = str(recipe.dataset_name or '').strip().lower()
    source = str(recipe.health_score_source or '').strip().lower()
    if dataset_name == 'hummus' or source.startswith('hummus_'):
        return _clamp_unit(value)
    if dataset_name == 'legacy':
        return _normalize_known_legacy_score(value)
    return _normalize_compatibility_score(value)

def _normalize_known_legacy_score(value: float) -> float | None:
    if value < 0.0 or value > 10.0:
        return None
    if value < 1.0:
        return value
    return value / 10.0

def _normalize_compatibility_score(value: float) -> float | None:
    if value < 0.0 or value > 10.0:
        return None
    if value <= 1.0:
        return value
    return value / 10.0

def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))
