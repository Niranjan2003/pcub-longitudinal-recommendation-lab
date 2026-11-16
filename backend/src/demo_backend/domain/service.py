from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from demo_backend.domain.platform import UserPersona
from demo_backend.domain.research import ResearchInitialState, RequestedChange
from demo_backend.domain.ontology import ResearchReaction, ResearchContinuation

class Request(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
class CreateSession(Request):
    world_kind: Literal['human_interaction','synthetic_simulation']
    policy: str='deterministic_recipe_recommendation'
    prediction_backend: Literal['current_structured_simulator@1','usersimcrs_agenda_derived@1']='current_structured_simulator@1'
    predictor: Literal['population','class_bias','contextual']='population'
    persona: UserPersona | None=None
    initial_state: ResearchInitialState | None=None
    request: str=Field(default='Recommend a safe recipe.',min_length=1,max_length=600)
    fixture: str | None=None
    segments: int=Field(default=2,ge=1,le=4,strict=True)
    turns_per_segment: int=Field(default=6,ge=1,le=12,strict=True)
    @model_validator(mode='after')
    def separation(self):
        if self.world_kind=='human_interaction':
            if self.persona is None or self.fixture is not None:raise ValueError('Human persona required; synthetic fixture forbidden')
            if self.persona.baseline_traits:raise ValueError('Human baseline_traits must be empty; no private tendencies')
        elif self.fixture is None or self.persona is not None or self.initial_state is not None:raise ValueError('Synthetic creation requires only a curated fixture')
        return self
class Revision(Request):
    expected_revision: int=Field(ge=0,strict=True)
class HumanOutcome(Request):
    reaction: ResearchReaction
    continuation: ResearchContinuation
    requested_changes: tuple[RequestedChange,...]=()
    source_evidence_ids: tuple[str,...]
    reference_kind: Literal['human_submission']='human_submission'
class Feedback(Revision):
    operation: Literal['feedback','cancel','close']='feedback'
    recommendation_id: str | None=None
    reaction: ResearchReaction | None=None
    continuation: ResearchContinuation=ResearchContinuation.CONTINUE
    requested_changes: tuple[RequestedChange,...]=()
class Compare(Revision):
    session_id: str
    policies: tuple[str,str]
    allocator: Literal['equal','greedy','uncertainty','pcub']='pcub'
    budget: Literal[2,4,8,12]=8
    oracle: bool=Field(default=False,strict=True)

class ServiceError(Exception):
    def __init__(self,code,status=409):
        self.code,self.status=code,status
        super().__init__(code)
