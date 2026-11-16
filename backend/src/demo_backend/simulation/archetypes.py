from __future__ import annotations
from demo_backend.domain.research import SimulatedResearchProfile

def profile_archetype(profile: SimulatedResearchProfile) -> str:
    prefix = 'pcub_outcome_parameterization:'
    identifier = profile.outcome_parameterization.identifier
    if not identifier.startswith(prefix):
        raise ValueError('profile does not declare a PCUB V1 outcome parameterization')
    return identifier[len(prefix):]
