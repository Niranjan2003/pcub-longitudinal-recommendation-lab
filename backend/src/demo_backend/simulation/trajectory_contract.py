from __future__ import annotations
from demo_backend.domain.research import ResearchObservation
from demo_backend.domain.research import Contract
from typing import Literal

class V2Trajectory(Contract):
    version: Literal['pcub_v2_trajectory_v1'] = 'pcub_v2_trajectory_v1'
    profile_id: str
    scenario_id: str
    observations: tuple[ResearchObservation, ...] = ()
