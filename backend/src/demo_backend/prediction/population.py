from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.split import ResearchSplit
from demo_backend.domain.versions import RQ1_PERSONALIZATION_VERSION
from demo_backend.domain.versions import RQ1_POPULATION_MODEL_VERSION
from demo_backend.prediction.records import EncodedPredictorInput

CLASS_ORDER: tuple[ResearchReaction, ...] = RESEARCH_REACTION_ORDER

CLASS_INDEX = {reaction: index for index, reaction in enumerate(CLASS_ORDER)}

def stable_softmax(logits: np.ndarray) -> np.ndarray:
    values = np.asarray(logits, dtype=np.float64)
    shifted = values - np.max(values, axis=-1, keepdims=True)
    exponentials = np.exp(shifted)
    probabilities = exponentials / exponentials.sum(axis=-1, keepdims=True)
    if not np.all(np.isfinite(probabilities)):
        raise ValueError('softmax produced non-finite probabilities')
    return probabilities

def validate_probabilities(probabilities: np.ndarray) -> np.ndarray:
    values = np.asarray(probabilities, dtype=np.float64)
    if values.shape != (len(CLASS_ORDER),):
        raise ValueError('probability vector has the wrong class dimension')
    if not np.all(np.isfinite(values)) or np.any(values < 0.0) or np.any(values > 1.0):
        raise ValueError('probabilities must be finite and between zero and one')
    if not np.isclose(values.sum(), 1.0, atol=1e-09):
        raise ValueError('probabilities must sum to one')
    return values

class NumpyMultinomialLogisticRegression:
    """Full-batch deterministic Adam optimization of multinomial log loss."""
    model_id = 'population_multinomial_logistic_regression'
    version = RQ1_POPULATION_MODEL_VERSION

    def __init__(self, *, l2_strength: float, learning_rate: float=0.05, max_iterations: int=1200, tolerance: float=1e-09, training_seed: int=20261028):
        if l2_strength < 0.0 or learning_rate <= 0.0 or max_iterations < 1:
            raise ValueError('invalid multinomial logistic configuration')
        self.l2_strength = float(l2_strength)
        self.learning_rate = float(learning_rate)
        self.max_iterations = int(max_iterations)
        self.tolerance = float(tolerance)
        self.training_seed = int(training_seed)
        self.coefficients: np.ndarray | None = None
        self.intercepts: np.ndarray | None = None
        self.iterations_run = 0
        self.final_objective: float | None = None
        self.converged = False

    def predict_logits(self, X: np.ndarray) -> np.ndarray:
        if self.coefficients is None or self.intercepts is None:
            raise RuntimeError('population model is not fitted')
        return np.asarray(X, dtype=np.float64) @ self.coefficients + self.intercepts

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return stable_softmax(self.predict_logits(X))

    def to_dict(self, *, feature_names: tuple[str, ...]) -> dict:
        if self.coefficients is None or self.intercepts is None:
            raise RuntimeError('cannot serialize an unfitted population model')
        return {'model_id': self.model_id, 'model_version': self.version, 'class_order': [item.value for item in CLASS_ORDER], 'fit_split': ResearchSplit.TRAIN.value, 'feature_names': list(feature_names), 'feature_count': len(feature_names), 'l2_strength': self.l2_strength, 'learning_rate': self.learning_rate, 'max_iterations': self.max_iterations, 'tolerance': self.tolerance, 'training_seed': self.training_seed, 'iterations_run': self.iterations_run, 'converged': self.converged, 'final_objective': self.final_objective, 'coefficients': self.coefficients.tolist(), 'intercepts': self.intercepts.tolist(), 'optimizer': 'deterministic_full_batch_adam', 'probability_calibration': 'none_raw_uncalibrated'}

    @classmethod
    def from_dict(cls, payload: dict):
        _validate_class_order(payload)
        model = cls(l2_strength=float(payload['l2_strength']), learning_rate=float(payload['learning_rate']), max_iterations=int(payload['max_iterations']), tolerance=float(payload['tolerance']), training_seed=int(payload['training_seed']))
        model.coefficients = np.asarray(payload['coefficients'], dtype=np.float64)
        model.intercepts = np.asarray(payload['intercepts'], dtype=np.float64)
        model.iterations_run = int(payload['iterations_run'])
        model.converged = bool(payload['converged'])
        model.final_objective = float(payload['final_objective'])
        if model.coefficients.shape[1] != len(CLASS_ORDER):
            raise ValueError('serialized model coefficient shape mismatch')
        return model

class PopulationPredictor:
    method_id = 'population_multinomial'

    def __init__(self, model: NumpyMultinomialLogisticRegression):
        self.model = model

    def start_state(self):
        return None

    def predict(self, observation: EncodedPredictorInput, state) -> np.ndarray:
        return validate_probabilities(self.model.predict_proba(observation.vector))

    def update(self, state, revealed_reaction: ResearchReaction) -> None:
        return None

@dataclass
class PersonalizationState:
    counts: np.ndarray

class PersonalizedPredictor:
    method_id = 'personalized_population'
    version = RQ1_PERSONALIZATION_VERSION

    def __init__(self, population_model: NumpyMultinomialLogisticRegression, train_prior: np.ndarray, *, prior_concentration: float):
        if prior_concentration <= 0.0:
            raise ValueError('prior concentration must be positive')
        self.population_model = population_model
        self.train_prior = validate_probabilities(train_prior.copy())
        self.prior_concentration = float(prior_concentration)

    def start_state(self) -> PersonalizationState:
        return PersonalizationState(np.zeros(len(CLASS_ORDER), dtype=np.float64))

    def predict(self, observation: EncodedPredictorInput, state: PersonalizationState) -> np.ndarray:
        population = validate_probabilities(self.population_model.predict_proba(observation.vector))
        posterior = (self.prior_concentration * self.train_prior + state.counts) / (self.prior_concentration + state.counts.sum())
        bias = np.log(np.clip(posterior, 1e-15, 1.0)) - np.log(np.clip(self.train_prior, 1e-15, 1.0))
        personalized = stable_softmax(np.log(np.clip(population, 1e-15, 1.0)) + bias)
        return validate_probabilities(personalized)

    def update(self, state: PersonalizationState, revealed_reaction: ResearchReaction) -> None:
        state.counts[CLASS_INDEX[revealed_reaction]] += 1.0

def _validate_class_order(payload: dict) -> None:
    if payload.get('class_order') != [item.value for item in CLASS_ORDER]:
        raise ValueError('serialized class order mismatch')
