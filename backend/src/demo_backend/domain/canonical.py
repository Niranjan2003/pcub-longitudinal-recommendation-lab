from __future__ import annotations
import hashlib
import json
from collections.abc import Sequence
from enum import Enum
from typing import Any
from pydantic import BaseModel
from demo_backend.domain.platform import RecipeItem

def canonical_json(value: Any) -> str:
    """Serialize scientific configuration without unstable formatting."""
    return json.dumps(_jsonable(value), sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)

def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()

def recipe_dataset_content_fingerprint(recipes: Sequence[RecipeItem]) -> str:
    """Hash portable recipe content so meaningful changes are detectable."""
    payload = [recipe.model_dump(mode='json') for recipe in recipes]
    return f'recipes-content-sha256:{fingerprint(payload)}'

def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode='json')
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value
