from __future__ import annotations
from typing import Literal
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.research import AuthoritativeOutcome
from demo_backend.domain.research import Contract
from demo_backend.domain.research import ResearchInitialState
from demo_backend.domain.versions import TRANSITION_POLICY_ID
from demo_backend.domain.versions import TRANSITION_POLICY_VERSION

_DELTAS: dict[ResearchReaction, dict[str, float]] = {ResearchReaction.ACCEPT: {'trust': 0.03, 'motivation': 0.04, 'fatigue': 0.01, 'satisfaction': 0.05, 'engagement': 0.03, 'resistance': -0.03}, ResearchReaction.MODIFY_CLARIFY: {'trust': 0.01, 'motivation': 0.0, 'fatigue': 0.02, 'satisfaction': 0.0, 'engagement': 0.02, 'resistance': 0.01}, ResearchReaction.DEFER: {'trust': 0.0, 'motivation': -0.01, 'fatigue': 0.04, 'satisfaction': -0.01, 'engagement': -0.02, 'resistance': 0.01}, ResearchReaction.REJECT: {'trust': -0.08, 'motivation': -0.04, 'fatigue': 0.05, 'satisfaction': -0.1, 'engagement': -0.05, 'resistance': 0.1}}

class PCUBTransitionResult(Contract):
    policy_id: Literal[TRANSITION_POLICY_ID] = TRANSITION_POLICY_ID
    policy_version: Literal[TRANSITION_POLICY_VERSION] = TRANSITION_POLICY_VERSION
    state_before: ResearchInitialState
    state_delta: dict[str, float]
    state_after: ResearchInitialState
    clipped_fields: tuple[str, ...] = ()

class PCUBSyntheticStateTransition:
    policy_id = TRANSITION_POLICY_ID
    policy_version = TRANSITION_POLICY_VERSION

    def apply(self, state_before: ResearchInitialState, outcome: AuthoritativeOutcome) -> PCUBTransitionResult:
        values = state_before.model_dump(mode='python')
        delta = dict(_DELTAS[outcome.reaction])
        clipped: list[str] = []
        for field, change in delta.items():
            raw = float(values[field]) + change
            if not 0.0 <= raw <= 1.0:
                clipped.append(field)
            values[field] = round(max(0.0, min(1.0, raw)), 4)
        preference_notes = list(values['recent_preferences'])
        for requested in outcome.requested_changes:
            if requested.instruction:
                preference_notes.append(requested.instruction)
        values['recent_preferences'] = tuple(preference_notes[-12:])
        state_after = ResearchInitialState(**values)
        return PCUBTransitionResult(state_before=state_before, state_delta=delta, state_after=state_after, clipped_fields=tuple(sorted(clipped)))
