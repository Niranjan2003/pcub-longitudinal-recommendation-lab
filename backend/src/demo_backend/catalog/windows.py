from __future__ import annotations
import math
from demo_backend.domain.platform import RecipeItem
from demo_backend.domain.seeds import stable_seed
from demo_backend.domain.versions import CANDIDATE_SELECTION_VERSION

DEFAULT_CANDIDATE_POOL_SIZE = 48

def _coprime_stride(length: int, seed: int) -> int:
    stride = max(1, seed % length)
    while math.gcd(stride, length) != 1:
        stride = (stride + 1) % length or 1
    return stride

def candidate_recipes(recipes: tuple[RecipeItem, ...], *, profile_id: str, dataset_fingerprint: str, ordinal: int, pool_size: int=DEFAULT_CANDIDATE_POOL_SIZE) -> tuple[RecipeItem, ...]:
    if not recipes:
        raise ValueError('candidate selection requires recipes')
    if pool_size < 1:
        raise ValueError('candidate pool size must be positive')
    size = min(pool_size, len(recipes))
    start = stable_seed(profile_id, dataset_fingerprint, CANDIDATE_SELECTION_VERSION, 'start') % len(recipes)
    stride = _coprime_stride(len(recipes), stable_seed(profile_id, dataset_fingerprint, CANDIDATE_SELECTION_VERSION, 'stride'))
    offset = (ordinal - 1) * size
    return tuple((recipes[(start + (offset + index) * stride) % len(recipes)] for index in range(size)))
