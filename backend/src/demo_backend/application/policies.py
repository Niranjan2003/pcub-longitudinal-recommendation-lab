from types import MappingProxyType
from demo_backend.recommendation.baselines import DeterministicRecommendationPolicy, ConstraintOnlyBaselinePolicy
from demo_backend.recommendation.feedback import FeedbackSequencePolicy
from demo_backend.recommendation.guarded import GuardedScoreVectorPolicy

POLICIES=(('deterministic_recipe_recommendation','1'),('constraint_only_baseline','1'),('feedback_sequence_recipe_recommendation','1'),('guarded_llm_score_vector','1'))
BACKENDS=('current_structured_simulator@1','usersimcrs_agenda_derived@1')
class PolicyResolver:
    def __init__(self, client, store, settings,guarded=None):
        values=(DeterministicRecommendationPolicy(),ConstraintOnlyBaselinePolicy(),FeedbackSequencePolicy(),guarded or GuardedScoreVectorPolicy(client,store,settings))
        self.policies=MappingProxyType(dict(zip(POLICIES,values)))
    def __call__(self, identifier, version):
        return self.policies[(identifier,version)]
