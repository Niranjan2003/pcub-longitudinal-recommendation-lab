from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.versions import BRANCH_EQUAL_ALLOCATOR_VERSION
from demo_backend.domain.versions import BRANCH_GREEDY_ALLOCATOR_VERSION
from demo_backend.domain.versions import BRANCH_PCUB_ALLOCATOR_VERSION
from demo_backend.domain.versions import BRANCH_UNCERTAINTY_ALLOCATOR_VERSION
from demo_backend.branching.contracts import FrontierCandidate

CLASS_INDEX = {reaction: index for index, reaction in enumerate(RESEARCH_REACTION_ORDER)}

def _tie_key(candidate: FrontierCandidate) -> tuple:
    return (candidate.depth, CLASS_INDEX[candidate.first_reaction], CLASS_INDEX[candidate.reaction], candidate.candidate_id)

class GreedyAllocator:
    allocator_id = 'greedy_highest_probability'
    version = BRANCH_GREEDY_ALLOCATOR_VERSION

    def select(self, frontier, expansion_counts) -> FrontierCandidate:
        return min(frontier, key=lambda item: (-item.probability_component, *_tie_key(item)))

class UncertaintyAllocator:
    allocator_id = 'uncertainty_first'
    version = BRANCH_UNCERTAINTY_ALLOCATOR_VERSION

    def select(self, frontier, expansion_counts) -> FrontierCandidate:
        return min(frontier, key=lambda item: (-item.uncertainty_component, *_tie_key(item)))

class EqualAllocator:
    allocator_id = 'equal_round_robin'
    version = BRANCH_EQUAL_ALLOCATOR_VERSION

    def select(self, frontier, expansion_counts) -> FrontierCandidate:
        return min(frontier, key=lambda item: (expansion_counts.get(item.first_reaction.value, 0), *_tie_key(item)))

@dataclass(frozen=True)
class PCUBWeights:
    probability: float
    uncertainty: float
    disagreement: float
    cost: float = 0.0

    def __post_init__(self):
        values = (self.probability, self.uncertainty, self.disagreement, self.cost)
        if any((not np.isfinite(value) or value < 0.0 for value in values)):
            raise ValueError('PCUB weights must be finite and nonnegative')
        if self.probability + self.uncertainty + self.disagreement <= 0.0:
            raise ValueError('at least one positive PCUB benefit weight is required')

    def as_dict(self) -> dict[str, float]:
        return {'probability': self.probability, 'uncertainty': self.uncertainty, 'disagreement': self.disagreement, 'cost': self.cost}

class PCUBAllocator:
    allocator_id = 'pcub_probability_uncertainty_disagreement'
    version = BRANCH_PCUB_ALLOCATOR_VERSION

    def __init__(self, weights: PCUBWeights):
        self.weights = weights

    def score(self, candidate: FrontierCandidate) -> float:
        return self.weights.probability * candidate.probability_component + self.weights.uncertainty * candidate.uncertainty_component + self.weights.disagreement * candidate.disagreement_component - self.weights.cost * candidate.cost_component

    def select(self, frontier, expansion_counts) -> FrontierCandidate:
        scored = [(self.score(item), item) for item in frontier]
        if any((not np.isfinite(score) for score, _ in scored)):
            raise ValueError('allocator score must be finite')
        return min(scored, key=lambda pair: (-pair[0], *_tie_key(pair[1])))[1]
