import numpy as np
from demo_backend.prediction.population import PopulationPredictor, PersonalizedPredictor, PersonalizationState
from demo_backend.prediction.contextual import ContextualPersonalizer, ContextualState
from demo_backend.prediction.records import EncodedPredictorInput
from demo_backend.domain.ontology import ResearchReaction

def adapter(bundle,method):
    p,m,s,t=bundle
    if method=='population':return PopulationPredictor(m)
    if method=='class_bias':return PersonalizedPredictor(m,np.asarray(s['prior']),prior_concentration=s['class_bias_concentration'])
    return ContextualPersonalizer(m,s['feature_indices'],learning_rate=s['contextual_rate'],l2=s['contextual_l2'])
def pack(state):
    if state is None:return None
    if isinstance(state,PersonalizationState):return {'counts':state.counts.tolist()}
    return {'weights':state.weights.tolist(),'updates':state.updates,'owner':state.owner,'last_depth':state.last_depth,'pending':None if state.pending is None else [state.pending[0].tolist(),state.pending[1].tolist(),state.pending[2]]}
def unpack(value):
    if value is None:return None
    if 'counts' in value:return PersonalizationState(np.asarray(value['counts'],dtype=np.float64))
    p=value['pending']
    return ContextualState(np.asarray(value['weights'],dtype=np.float64),value['updates'],None if p is None else (np.asarray(p[0]),np.asarray(p[1]),p[2]),None if value['owner'] is None else tuple(value['owner']),value['last_depth'])
def predict(bundle,method,state,inp,subject,scenario,observation):
    view=EncodedPredictorInput(observation,subject,scenario,inp.recommender_policy.identifier,inp.position.session_index,inp.position.turn_index,len(inp.history),tuple(h.reaction for h in inp.history),bundle[0].transform(inp))
    a=adapter(bundle,method);st=unpack(state);probs=a.predict(view,st)
    return probs.tolist(),pack(st)
def reveal(bundle,method,state,reaction):
    a=adapter(bundle,method);st=unpack(state);a.update(st,ResearchReaction(reaction));return pack(st)
def conformal_reference(bundle,inp,observation):
    import hashlib
    from demo_backend.uncertainty.conformal import ConformalMethod
    from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
    p,m,settings,thresholds=bundle;probabilities=m.predict_proba(p.transform(inp))
    u=int.from_bytes(hashlib.sha256(('2026102905|'+observation).encode()).digest()[:8],'big')/2**64
    return {'meaning':'Frozen synthetic reference calibration; no human coverage guarantee; no branch pruning','population_probabilities':probabilities.tolist(),'sets':{name:{coverage:[RESEARCH_REACTION_ORDER[i].value for i in ConformalMethod(**spec).prediction_set(probabilities,threshold,u)] for coverage,threshold in thresholds[name].items()} for name,spec in settings['conformal_methods'].items()}}
