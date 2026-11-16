from __future__ import annotations
import math
import numpy as np
from demo_backend.prediction.population import CLASS_ORDER

def deterministic_order(probabilities: np.ndarray) -> np.ndarray:
    values = np.asarray(probabilities, dtype=np.float64)
    if values.shape != (len(CLASS_ORDER),):
        raise ValueError('probability vector has the wrong class dimension')
    return np.lexsort((np.arange(len(CLASS_ORDER)), -values))

def aps_score(probabilities: np.ndarray, true_class_index: int) -> float:
    """Cumulative descending mass through the true class (inclusive)."""
    order = deterministic_order(probabilities)
    matches = np.flatnonzero(order == int(true_class_index))
    if len(matches) != 1:
        raise ValueError('true class index is invalid')
    rank = int(matches[0])
    return float(np.asarray(probabilities, dtype=np.float64)[order[:rank + 1]].sum())

def conformal_threshold(scores: np.ndarray, target_coverage: float) -> tuple[float, int]:
    """Return q at rank clip(ceil((n+1)*coverage), 1, n), using 1-based rank."""
    values = np.asarray(scores, dtype=np.float64)
    if values.ndim != 1 or len(values) == 0 or (not np.all(np.isfinite(values))):
        raise ValueError('finite non-empty calibration scores are required')
    if not 0.0 < target_coverage < 1.0:
        raise ValueError('target coverage must lie strictly between zero and one')
    rank = min(len(values), max(1, math.ceil((len(values) + 1) * target_coverage)))
    return (float(np.sort(values, kind='stable')[rank - 1]), rank)

def prediction_set(probabilities: np.ndarray, threshold: float) -> tuple[int, ...]:
    """Smallest descending-probability prefix whose cumulative mass reaches q."""
    if not np.isfinite(threshold) or threshold < 0.0:
        raise ValueError('threshold must be finite and nonnegative')
    values = np.asarray(probabilities, dtype=np.float64)
    order = deterministic_order(values)
    cumulative = 0.0
    selected: list[int] = []
    for class_index in order:
        selected.append(int(class_index))
        cumulative += float(values[class_index])
        if cumulative >= threshold:
            break
    if not selected:
        selected.append(int(order[0]))
    return tuple(selected)
