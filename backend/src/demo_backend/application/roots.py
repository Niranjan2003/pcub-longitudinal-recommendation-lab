from demo_backend.domain.roots import RootContext, PublicProfile, PublicScenario
from demo_backend.domain.research import ResearchObservation, SimulatedResearchProfile, ResearchScenario, PredictorInput, ProfileCharacteristics, SessionPlan, CurrentContext, VersionedReference, ResearchInitialState
from demo_backend.domain.platform import UserPersona
from demo_backend.simulation.profile_adapter import _persona

def synthetic_root(row,profile,scenario,recipes):
    # Private profile is consumed here; only its public projection leaves this adapter.
    return RootContext(row.observation_id,PublicProfile(profile.profile_id,profile.characteristics),PublicScenario(scenario.scenario_id,scenario.dataset,scenario.session_plan,scenario.initial_context),row.predictor_input,recipes,_persona(profile))
def session_root(s,recipes):
    if s['pending'] is None:raise ValueError('A pending factual recommendation pins the root')
    persona=UserPersona.model_validate(s['persona'])
    inp=PredictorInput.model_validate(s['pending']['predictor_input'])
    scenario=PublicScenario(s['id'],VersionedReference.model_validate(s['dataset']),SessionPlan(**s['plan']),CurrentContext(request=s['request']))
    return RootContext(s['pending']['id'],PublicProfile(s['subject_id'],inp.profile_features),scenario,inp,recipes,persona,ResearchInitialState.model_validate(s['state']))
