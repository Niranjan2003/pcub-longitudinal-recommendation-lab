from __future__ import annotations
from demo_backend.domain.platform import DynamicUserState
from demo_backend.domain.platform import UserPersona
from demo_backend.domain.research import LegalFeature
from demo_backend.domain.research import Position
from demo_backend.domain.research import ResearchInitialState
from demo_backend.domain.research import SimulatedResearchProfile
from demo_backend.domain.research import VersionedReference
from demo_backend.domain.versions import TRANSITION_POLICY_VERSION

_STATE_FIELDS = ('trust', 'motivation', 'fatigue', 'satisfaction', 'engagement', 'resistance')

def _persona(profile: SimulatedResearchProfile) -> UserPersona:
    effort_limit = 30.0 if profile.tendencies.preparation_effort_tolerance < 0.38 else None
    ingredient_limit = 12 if profile.tendencies.budget_sensitivity > 0.72 else None
    return UserPersona(user_id=profile.profile_id, display_name=profile.profile_id, dietary_pattern=profile.characteristics.dietary_pattern, allergies=list(profile.characteristics.allergies), excluded_ingredients=list(profile.characteristics.excluded_ingredients), health_goals=list(profile.characteristics.health_goals), taste_preferences=list(profile.characteristics.taste_preferences), max_total_time_minutes=effort_limit, max_ingredient_count=ingredient_limit, baseline_traits={'source': 'pcub_profile_v1'})

def _dynamic_state(state: ResearchInitialState) -> DynamicUserState:
    return DynamicUserState(**state.model_dump(mode='python', exclude={'specification_version'}))

def _state_features(state: ResearchInitialState, position: Position, source_evidence_id: str) -> tuple[LegalFeature, ...]:
    return tuple((LegalFeature(feature_specification=VersionedReference(identifier=f'dynamic_state.{field}', version=TRANSITION_POLICY_VERSION), value=float(getattr(state, field)), available_at=position, source_evidence_ids=(source_evidence_id,)) for field in _STATE_FIELDS))
