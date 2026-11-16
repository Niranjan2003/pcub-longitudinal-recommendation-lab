
import dataclasses, enum, json, math, os
from pathlib import Path
import numpy as np
from demo_backend.adapters.resources import Resources
from demo_backend.domain.research import *
from demo_backend.domain.platform import UserPersona,DynamicUserState,RecipeItem,RecommendationAgentOutput
from demo_backend.ports.recommendation import RecommendationContext
from demo_backend.simulation.structured import PCUBOutcomeContext

def cv(x):
    if hasattr(x,'model_dump'):return cv(x.model_dump(mode='json'))
    if dataclasses.is_dataclass(x):return {f.name:cv(getattr(x,f.name)) for f in dataclasses.fields(x)}
    if isinstance(x,enum.Enum):return x.value
    if hasattr(x,'tolist'):return cv(x.tolist())
    if isinstance(x,dict):return {str(k):cv(v) for k,v in x.items()}
    if isinstance(x,(tuple,list)):return [cv(v) for v in x]
    if isinstance(x,float) and not math.isfinite(x):return {'nonfinite':str(x)}
    return x
def resources():return Resources(Path(os.environ.get('DEMO_ASSETS','assets')))
def context(d):
    memory=dict(d['memory_context']);memory['observable_history']=tuple(HistoryEntry.model_validate(x) for x in memory.get('observable_history',[]))
    # Golden fault-injection items may deliberately violate validation (empty ingredients).
    # model_construct is confined to adversarial fixtures, never service inputs.
    items=tuple(RecipeItem.model_construct(**r) if not r.get('ingredients') else RecipeItem.model_validate(r) for r in d['recipes'])
    return RecommendationContext(UserPersona.model_validate(d['persona']),DynamicUserState.model_validate(d['state']),items,d['turn_index'],memory)
def private(d):
    return PCUBOutcomeContext(SimulatedResearchProfile.model_validate(d['profile']),ResearchScenario.model_validate(d['scenario']),Position.model_validate(d['position']),RecipeItem.model_validate(d['selected_recipe']),tuple(d['constraint_violations']),ResearchInitialState.model_validate(d['state_before']),tuple(HistoryEntry.model_validate(h) for h in d['history']),tuple(d['recent_recipe_ids']))
def result(fn):
    try:return {'value':cv(fn())}
    except Exception as e:return {'error_type':type(e).__name__,'message':str(e)}
