from __future__ import annotations
from dataclasses import dataclass
from itertools import groupby
import numpy as np
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.versions import RQ1_PREQUENTIAL_VERSION
from demo_backend.prediction.records import EncodedDataset
from demo_backend.evaluation.prediction_metrics import multiclass_brier
from demo_backend.evaluation.prediction_metrics import negative_log_likelihood
from demo_backend.prediction.population import CLASS_ORDER
from demo_backend.prediction.population import validate_probabilities

@dataclass(frozen=True)
class PredictionRecord:
    method_id: str
    observation_id: str
    profile_id: str
    scenario_id: str
    policy_id: str
    session_index: int
    turn_index: int
    history_depth: int
    probabilities: tuple[float, ...]
    true_reaction: ResearchReaction
    predicted_reaction: ResearchReaction
    nll: float
    brier: float
    chronology_version: str = RQ1_PREQUENTIAL_VERSION

    def to_dict(self) -> dict:
        return {'method_id': self.method_id, 'observation_id': self.observation_id, 'profile_id': self.profile_id, 'scenario_id': self.scenario_id, 'policy_id': self.policy_id, 'session_index': self.session_index, 'turn_index': self.turn_index, 'history_depth': self.history_depth, 'class_order': [item.value for item in CLASS_ORDER], 'probabilities': {reaction.value: self.probabilities[index] for index, reaction in enumerate(CLASS_ORDER)}, 'true_reaction': self.true_reaction.value, 'predicted_reaction': self.predicted_reaction.value, 'nll': self.nll, 'brier': self.brier, 'chronology_version': self.chronology_version}

def evaluate_prequential(predictor, dataset: EncodedDataset) -> tuple[PredictionRecord, ...]:
    """Predict and score before revealing each current reaction to the predictor."""
    ordered = sorted(dataset.observations, key=lambda item: (item.scenario_id, item.session_index, item.turn_index))
    records: list[PredictionRecord] = []
    for scenario_id, group in groupby(ordered, key=lambda item: item.scenario_id):
        state = predictor.start_state()
        revealed: list[ResearchReaction] = []
        expected_depth = 0
        for observation in group:
            predictor_input = observation.predictor_view()
            _validate_history(predictor_input, scenario_id, revealed, expected_depth)
            probabilities = validate_probabilities(np.asarray(predictor.predict(predictor_input, state), dtype=np.float64))
            revealed_reaction = observation.reaction
            predicted = CLASS_ORDER[int(np.argmax(probabilities))]
            record = PredictionRecord(method_id=predictor.method_id, observation_id=observation.observation_id, profile_id=observation.profile_id, scenario_id=observation.scenario_id, policy_id=observation.policy_id, session_index=observation.session_index, turn_index=observation.turn_index, history_depth=observation.history_depth, probabilities=tuple((float(item) for item in probabilities)), true_reaction=revealed_reaction, predicted_reaction=predicted, nll=negative_log_likelihood(probabilities, revealed_reaction), brier=multiclass_brier(probabilities, revealed_reaction))
            records.append(record)
            predictor.update(state, revealed_reaction)
            revealed.append(revealed_reaction)
            expected_depth += 1
    return tuple(records)

def _validate_history(observation, scenario_id: str, revealed: list[ResearchReaction], expected_depth: int) -> None:
    if observation.scenario_id != scenario_id:
        raise ValueError('scenario grouping changed during prequential evaluation')
    if observation.history_depth != expected_depth:
        raise ValueError('trajectory history depth is not chronological')
    if observation.prior_reactions != tuple(revealed):
        raise ValueError('predictor history differs from reactions revealed so far')
