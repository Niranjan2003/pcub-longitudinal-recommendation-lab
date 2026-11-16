from __future__ import annotations
from dataclasses import dataclass
import math
import numpy as np
from demo_backend.prediction.population import CLASS_INDEX
from demo_backend.prediction.population import stable_softmax
from demo_backend.prediction.population import validate_probabilities

@dataclass
class ContextualState:
    weights: np.ndarray
    updates: int = 0
    pending: tuple | None = None
    owner: tuple[str, str] | None = None
    last_depth: int = -1

class ContextualPersonalizer:
    method_id = 'contextual_online_personalization_v1'
    version = 'pcub_v2_contextual_regularized_softmax_v1'

    def __init__(self, population_model, feature_indices, *, learning_rate=0.05, l2=0.1):
        self.population_model = population_model
        self.feature_indices = tuple(feature_indices)
        if not self.feature_indices or len(set(self.feature_indices)) != len(self.feature_indices):
            raise ValueError('Unique contextual feature indices required')
        if any((not isinstance(i, int) or i < 0 for i in self.feature_indices)):
            raise ValueError('Invalid feature index')
        if not math.isfinite(learning_rate) or learning_rate <= 0 or (not math.isfinite(l2)) or (l2 < 0):
            raise ValueError('Invalid adapter hyperparameters')
        self.learning_rate = learning_rate
        self.l2 = l2

    def start_state(self):
        return ContextualState(np.zeros((1 + len(self.feature_indices), 4)))

    def predict(self, observation, state):
        if state.pending is not None:
            raise ValueError('Reveal/update pending prediction before predicting again')
        owner = (observation.profile_id, observation.scenario_id)
        if state.owner is not None and state.owner != owner:
            raise ValueError('Cannot share personalization across profiles/scenarios')
        if observation.history_depth != state.last_depth + 1:
            raise ValueError('Non-prequential observation order')
        x = np.r_[1.0, np.clip(observation.vector[list(self.feature_indices)], -3, 3)]
        if not np.all(np.isfinite(x)):
            raise ValueError('Nonfinite observable features')
        population = validate_probabilities(self.population_model.predict_proba(observation.vector))
        probabilities = stable_softmax(np.log(np.clip(population, 1e-15, 1)) + x @ state.weights)
        state.owner = owner
        state.pending = (x.copy(), probabilities.copy(), observation.history_depth)
        return probabilities.copy()

    def update(self, state, revealed_reaction):
        if state.pending is None:
            raise ValueError('Cannot update without a frozen prior prediction')
        x, p, depth = state.pending
        target = np.zeros(4)
        target[CLASS_INDEX[revealed_reaction]] = 1
        step = self.learning_rate / math.sqrt(1 + state.updates)
        gradient = np.outer(x, p - target) / (1 + float(x @ x)) + self.l2 * state.weights
        state.weights -= step * gradient
        state.updates += 1
        state.last_depth = depth
        state.pending = None
