from __future__ import annotations
import math
from collections.abc import Mapping
from collections.abc import Sequence

def stable_softmax(utilities: Mapping[str, float], class_order: Sequence[str], *, temperature: float) -> dict[str, float]:
    """Normalize finite utilities using canonical ordering and stable softmax."""
    if not class_order:
        raise ValueError('class_order cannot be empty')
    if len(set(class_order)) != len(class_order):
        raise ValueError('class_order cannot contain duplicates')
    if set(utilities) != set(class_order):
        raise ValueError('utilities must contain exactly the declared classes')
    numeric_temperature = float(temperature)
    if not math.isfinite(numeric_temperature) or numeric_temperature <= 0.0:
        raise ValueError('temperature must be finite and greater than 0')
    scaled: list[float] = []
    for reaction in class_order:
        utility = float(utilities[reaction])
        if not math.isfinite(utility):
            raise ValueError('utilities must be finite')
        scaled.append(utility / numeric_temperature)
    maximum = max(scaled)
    exponentials = [math.exp(value - maximum) for value in scaled]
    denominator = sum(exponentials)
    if not math.isfinite(denominator) or denominator <= 0.0:
        raise ValueError('softmax normalization failed')
    return {reaction: exponential / denominator for reaction, exponential in zip(class_order, exponentials, strict=True)}

def canonical_argmax(probabilities: Mapping[str, float], class_order: Sequence[str]) -> str:
    """Return the first maximum according to the declared canonical order."""
    if not class_order or set(probabilities) != set(class_order):
        raise ValueError('probabilities must contain exactly the declared classes')
    maximum = max((float(probabilities[label]) for label in class_order))
    return next((label for label in class_order if float(probabilities[label]) == maximum))

def distribution_entropy(probabilities: Mapping[str, float]) -> float:
    """Return natural-log Shannon entropy for a finite probability mapping."""
    entropy = 0.0
    for probability in probabilities.values():
        numeric = float(probability)
        if not math.isfinite(numeric) or numeric < 0.0 or numeric > 1.0:
            raise ValueError('probabilities must be finite and between 0 and 1')
        if numeric > 0.0:
            entropy -= numeric * math.log(numeric)
    return entropy

def stable_sigmoid(value: float) -> float:
    """Return a numerically stable logistic transform."""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError('sigmoid input must be finite')
    if numeric >= 0.0:
        inverse = math.exp(-numeric)
        return 1.0 / (1.0 + inverse)
    exponential = math.exp(numeric)
    return exponential / (1.0 + exponential)
