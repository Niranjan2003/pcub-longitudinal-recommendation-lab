from __future__ import annotations
import numpy as np
from demo_backend.prediction.base_features import PCUBFeaturePipeline
from demo_backend.domain.research import PredictorInput
from demo_backend.catalog.health import normalized_health_score
from demo_backend.recommendation.feedback import effort

EXTRA = ('catalog.effort', 'catalog.health', 'catalog.fatigue_effort')

class FeaturePipeline:

    def __init__(self, base, recipes):
        self.base = base
        self.recipes = {r.recipe_id: r for r in recipes}

    @property
    def feature_names(self):
        return (*self.base.feature_names, *EXTRA)

    def transform(self, value):
        if not isinstance(value, PredictorInput):
            raise TypeError('Only PredictorInput is accepted')
        item = value.action.selected_item
        recipe = self.recipes.get(item.item_id) if item else None
        e = effort(recipe) if recipe else 1.0
        h = float(normalized_health_score(recipe) or 0) if recipe else 0.0
        fatigue = next((float(f.value) for f in value.features if f.feature_specification.identifier == 'dynamic_state.fatigue'), 0.0)
        return np.r_[self.base.transform(value), e, h, e * fatigue]

    def to_dict(self):
        return {'version': 'pcub_v2_catalog_observable_features_v1', 'base': self.base.to_dict(), 'extra': list(EXTRA)}

    @classmethod
    def from_dict(cls, payload, recipes):
        if payload['extra'] != list(EXTRA):
            raise ValueError('Unexpected V2 catalog features')
        return cls(PCUBFeaturePipeline.from_dict(payload['base']), recipes)
