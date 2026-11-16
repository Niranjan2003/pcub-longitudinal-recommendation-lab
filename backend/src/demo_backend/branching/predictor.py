from __future__ import annotations
from demo_backend.domain.research import PredictorInput
from demo_backend.simulation.profile_adapter import _state_features

class BranchPredictor:
    predictor_id = 'v2_catalog_population'
    version = 'pcub_v2_catalog_population_branch_predictor_v1'

    def __init__(self, pipeline, model):
        self.pipeline = pipeline
        self.model = model

    def predict(self, *, position, action, policy, profile_features, context, history, state, evidence_id):
        value = PredictorInput(position=position, action=action, recommender_policy=policy, profile_features=profile_features, context=context, history=history, features=_state_features(state, position, evidence_id))
        return tuple(map(float, self.model.predict_proba(self.pipeline.transform(value))))
