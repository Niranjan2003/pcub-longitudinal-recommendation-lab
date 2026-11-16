from __future__ import annotations
import math
from collections.abc import Sequence
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.prediction.population import CLASS_INDEX
from demo_backend.prediction.population import CLASS_ORDER

def negative_log_likelihood(probabilities: Sequence[float], truth: ResearchReaction) -> float:
    probability = min(max(float(probabilities[CLASS_INDEX[truth]]), 1e-15), 1.0)
    return -math.log(probability)

def multiclass_brier(probabilities: Sequence[float], truth: ResearchReaction) -> float:
    return sum(((float(probabilities[index]) - float(reaction == truth)) ** 2 for index, reaction in enumerate(CLASS_ORDER)))
