from dataclasses import dataclass
from demo_backend.domain.platform import UserPersona, RecipeItem
from demo_backend.domain.research import ProfileCharacteristics, PredictorInput, CurrentContext, SessionPlan, VersionedReference, ResearchInitialState

@dataclass(frozen=True)
class PublicProfile:
    profile_id: str
    characteristics: ProfileCharacteristics

@dataclass(frozen=True)
class PublicScenario:
    scenario_id: str
    dataset: VersionedReference
    session_plan: SessionPlan
    initial_context: CurrentContext

@dataclass(frozen=True)
class RootContext:
    root_context_id: str
    profile: PublicProfile
    scenario: PublicScenario
    predictor_input: PredictorInput
    recipes: tuple[RecipeItem, ...]
    persona: UserPersona
    state_snapshot: ResearchInitialState | None=None
    def persona_copy(self):
        return self.persona.model_copy(deep=True)

def _persona(root):
    return root.persona_copy()
