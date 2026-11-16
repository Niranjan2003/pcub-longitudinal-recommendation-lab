from typing import Protocol
class FrozenCalibratedBranchPredictor(Protocol):
    def predict(self, *, position, action, policy, profile_features, context, history, state, evidence_id):
        raise NotImplementedError
