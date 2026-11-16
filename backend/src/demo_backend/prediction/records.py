from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.split import ResearchSplit

@dataclass(frozen=True)
class EncodedPredictorInput:
    observation_id: str
    profile_id: str
    scenario_id: str
    policy_id: str
    session_index: int
    turn_index: int
    history_depth: int
    prior_reactions: tuple[ResearchReaction, ...]
    vector: np.ndarray

@dataclass(frozen=True)
class EncodedObservation:
    observation_id: str
    profile_id: str
    scenario_id: str
    policy_id: str
    session_index: int
    turn_index: int
    history_depth: int
    prior_reactions: tuple[ResearchReaction, ...]
    vector: np.ndarray
    reaction: ResearchReaction

    def predictor_view(self) -> EncodedPredictorInput:
        """Return the label-free object that prediction methods are allowed to see."""
        return EncodedPredictorInput(observation_id=self.observation_id, profile_id=self.profile_id, scenario_id=self.scenario_id, policy_id=self.policy_id, session_index=self.session_index, turn_index=self.turn_index, history_depth=self.history_depth, prior_reactions=self.prior_reactions, vector=self.vector)

@dataclass(frozen=True)
class EncodedDataset:
    split: ResearchSplit
    observations: tuple[EncodedObservation, ...]

    @property
    def X(self) -> np.ndarray:
        if not self.observations:
            raise ValueError(f'{self.split.value} dataset is empty')
        return np.stack([item.vector for item in self.observations])

    @property
    def reactions(self) -> tuple[ResearchReaction, ...]:
        return tuple((item.reaction for item in self.observations))
