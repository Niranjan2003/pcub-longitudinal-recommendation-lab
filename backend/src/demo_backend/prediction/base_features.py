from __future__ import annotations
import re
from collections import Counter
import numpy as np
from demo_backend.domain.canonical import fingerprint
from demo_backend.domain.ontology import ChangeDimension
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.ontology import ResearchContinuation
from demo_backend.domain.research import PredictorInput
from demo_backend.domain.split import ResearchSplit
from demo_backend.domain.versions import RQ1_FEATURE_PIPELINE_VERSION

STATE_FEATURES = ('trust', 'motivation', 'fatigue', 'satisfaction', 'engagement', 'resistance')

CONTINUOUS_FEATURES = ('position.session_index', 'position.turn_index', 'history.depth', 'selected.ingredient_count', 'selected.known_constraint_count', 'selected.title_token_count', 'selected.taste_text_match_rate', 'selected.health_goal_text_match_rate', 'selected.excluded_text_match_count', 'selected.allergy_text_match_count', 'history.current_item_previous_count', 'history.exact_item_repetition', 'history.disengage_rate', 'history.unique_item_rate', *(f'state.{name}' for name in STATE_FEATURES), *(f'history.reaction_rate.{reaction.value}' for reaction in RESEARCH_REACTION_ORDER), *(f'history.requested_change_rate.{dimension.value}' for dimension in ChangeDimension))

FIXED_BINARY_FEATURES = tuple((f'history.last_reaction.{reaction.value}' for reaction in RESEARCH_REACTION_ORDER))

CATEGORY_GROUPS = ('policy', 'dietary_pattern', 'allergy', 'excluded_ingredient', 'health_goal', 'taste_preference', 'context_constraint', 'action_known_constraint')

UNKNOWN_CATEGORY = '__UNKNOWN__'

FORBIDDEN_FEATURE_TOKENS = ('archetype', 'outcome_parameterization', 'outcome_probability', 'generator_coefficient', 'current_reaction', 'current_continuation', 'current_requested_change', 'future_')

def _normalized(value: str) -> str:
    return re.sub('\\s+', ' ', str(value).casefold().strip())

def _tokens(*values: str) -> set[str]:
    text = ' '.join(values)
    return set(re.findall('[a-z0-9]+', text.casefold()))

def _phrase_match_rate(values: tuple[str, ...], searchable: str) -> float:
    if not values:
        return 0.0
    normalized = _normalized(searchable)
    return sum((_normalized(value) in normalized for value in values)) / len(values)

def _categories(predictor_input: PredictorInput) -> dict[str, set[str]]:
    profile = predictor_input.profile_features
    selected = predictor_input.action.selected_item
    return {'policy': {_normalized(f'{predictor_input.recommender_policy.identifier}@{predictor_input.recommender_policy.version}')}, 'dietary_pattern': {_normalized(profile.dietary_pattern)}, 'allergy': {_normalized(value) for value in profile.allergies}, 'excluded_ingredient': {_normalized(value) for value in profile.excluded_ingredients}, 'health_goal': {_normalized(value) for value in profile.health_goals}, 'taste_preference': {_normalized(value) for value in profile.taste_preferences}, 'context_constraint': {_normalized(value) for value in predictor_input.context.known_constraints}, 'action_known_constraint': {_normalized(value) for value in (selected.known_constraints if selected else ())}}

def _continuous(predictor_input: PredictorInput) -> dict[str, float]:
    history = predictor_input.history
    depth = len(history)
    selected = predictor_input.action.selected_item
    ingredients = tuple(selected.ingredients) if selected else ()
    title = selected.title if selected else ''
    searchable = ' '.join((title, *ingredients))
    selected_id = selected.item_id if selected else None
    previous_ids = [entry.action.selected_item.item_id for entry in history if entry.action.selected_item is not None]
    reaction_counts = Counter((entry.reaction for entry in history if entry.reaction is not None))
    change_counts = Counter((dimension for entry in history for change in entry.requested_changes for dimension in change.dimensions))
    disengaged = sum((entry.continuation == ResearchContinuation.DISENGAGE for entry in history))
    state_values = {feature.feature_specification.identifier.rsplit('.', 1)[-1]: float(feature.value) for feature in predictor_input.features if feature.feature_specification.identifier.startswith('dynamic_state.') and isinstance(feature.value, (int, float))}
    profile = predictor_input.profile_features
    values: dict[str, float] = {'position.session_index': float(predictor_input.position.session_index), 'position.turn_index': float(predictor_input.position.turn_index), 'history.depth': float(depth), 'selected.ingredient_count': float(len(ingredients)), 'selected.known_constraint_count': float(len(selected.known_constraints) if selected else 0), 'selected.title_token_count': float(len(_tokens(title))), 'selected.taste_text_match_rate': _phrase_match_rate(profile.taste_preferences, searchable), 'selected.health_goal_text_match_rate': _phrase_match_rate(profile.health_goals, searchable), 'selected.excluded_text_match_count': float(sum((_normalized(value) in _normalized(searchable) for value in profile.excluded_ingredients))), 'selected.allergy_text_match_count': float(sum((_normalized(value) in _normalized(searchable) for value in profile.allergies))), 'history.current_item_previous_count': float(previous_ids.count(selected_id) if selected_id else 0), 'history.exact_item_repetition': float(bool(selected_id and selected_id in previous_ids)), 'history.disengage_rate': disengaged / depth if depth else 0.0, 'history.unique_item_rate': len(set(previous_ids)) / len(previous_ids) if previous_ids else 0.0}
    values.update({f'state.{name}': state_values.get(name, 0.0) for name in STATE_FEATURES})
    values.update({f'history.reaction_rate.{reaction.value}': reaction_counts[reaction] / depth if depth else 0.0 for reaction in RESEARCH_REACTION_ORDER})
    values.update({f'history.requested_change_rate.{dimension.value}': change_counts[dimension] / depth if depth else 0.0 for dimension in ChangeDimension})
    return values

def _fixed_binary(predictor_input: PredictorInput) -> dict[str, float]:
    last = predictor_input.history[-1].reaction if predictor_input.history else None
    return {f'history.last_reaction.{reaction.value}': float(last == reaction) for reaction in RESEARCH_REACTION_ORDER}

class PCUBFeaturePipeline:
    version = RQ1_FEATURE_PIPELINE_VERSION

    def __init__(self):
        self.fit_split: str | None = None
        self.category_vocabulary: dict[str, tuple[str, ...]] = {}
        self.feature_names: tuple[str, ...] = ()
        self.continuous_means: dict[str, float] = {}
        self.continuous_scales: dict[str, float] = {}
        self._index: dict[str, int] = {}

    def _validate_feature_names(self) -> None:
        if len(self.feature_names) != len(set(self.feature_names)):
            raise ValueError('feature names must be unique')
        lowered = '\n'.join(self.feature_names).casefold()
        leaked = [token for token in FORBIDDEN_FEATURE_TOKENS if token in lowered]
        if leaked:
            raise ValueError(f'forbidden feature names detected: {leaked}')

    def transform(self, predictor_input: PredictorInput) -> np.ndarray:
        if self.fit_split != ResearchSplit.TRAIN.value:
            raise RuntimeError('feature pipeline must be fitted on TRAIN first')
        vector = np.zeros(len(self.feature_names), dtype=np.float64)
        for name, value in _continuous(predictor_input).items():
            vector[self._index[name]] = (value - self.continuous_means[name]) / self.continuous_scales[name]
        for name, value in _fixed_binary(predictor_input).items():
            vector[self._index[name]] = value
        for group, values in _categories(predictor_input).items():
            allowed = set(self.category_vocabulary[group])
            unknown = False
            for value in values:
                if value in allowed:
                    vector[self._index[f'category.{group}={value}']] = 1.0
                else:
                    unknown = True
            if unknown:
                vector[self._index[f'category.{group}={UNKNOWN_CATEGORY}']] = 1.0
        if not np.all(np.isfinite(vector)):
            raise ValueError('feature vector contains a non-finite value')
        return vector

    def to_dict(self) -> dict:
        if self.fit_split is None:
            raise RuntimeError('cannot serialize an unfitted feature pipeline')
        payload = {'feature_pipeline_version': self.version, 'fit_split': self.fit_split, 'feature_names': list(self.feature_names), 'feature_count': len(self.feature_names), 'continuous_feature_names': list(CONTINUOUS_FEATURES), 'fixed_binary_feature_names': list(FIXED_BINARY_FEATURES), 'category_vocabulary': {group: list(self.category_vocabulary[group]) for group in CATEGORY_GROUPS}, 'continuous_means': self.continuous_means, 'continuous_scales': self.continuous_scales, 'unknown_category_policy': 'group_specific_unknown_indicator', 'legal_source_contract': 'PredictorInput_only', 'forbidden_feature_tokens': list(FORBIDDEN_FEATURE_TOKENS)}
        payload['feature_specification_fingerprint'] = fingerprint(payload)
        return payload

    @classmethod
    def from_dict(cls, payload: dict) -> 'PCUBFeaturePipeline':
        expected = payload.get('feature_specification_fingerprint')
        unsigned = dict(payload)
        unsigned.pop('feature_specification_fingerprint', None)
        if expected != fingerprint(unsigned):
            raise ValueError('feature specification fingerprint mismatch')
        if payload.get('feature_pipeline_version') != RQ1_FEATURE_PIPELINE_VERSION:
            raise ValueError('unsupported feature pipeline version')
        pipeline = cls()
        pipeline.fit_split = str(payload['fit_split'])
        pipeline.category_vocabulary = {group: tuple(payload['category_vocabulary'][group]) for group in CATEGORY_GROUPS}
        pipeline.feature_names = tuple(payload['feature_names'])
        pipeline.continuous_means = {str(key): float(value) for key, value in payload['continuous_means'].items()}
        pipeline.continuous_scales = {str(key): float(value) for key, value in payload['continuous_scales'].items()}
        pipeline._index = {name: index for index, name in enumerate(pipeline.feature_names)}
        pipeline._validate_feature_names()
        return pipeline
