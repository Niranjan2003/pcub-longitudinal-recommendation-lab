from __future__ import annotations
from enum import Enum

class ResearchReaction(str, Enum):
    ACCEPT = 'ACCEPT'
    MODIFY_CLARIFY = 'MODIFY_CLARIFY'
    DEFER = 'DEFER'
    REJECT = 'REJECT'

RESEARCH_REACTION_ORDER: tuple[ResearchReaction, ...] = (ResearchReaction.ACCEPT, ResearchReaction.MODIFY_CLARIFY, ResearchReaction.DEFER, ResearchReaction.REJECT)

class ResearchContinuation(str, Enum):
    CONTINUE = 'CONTINUE'
    DISENGAGE = 'DISENGAGE'

class ChangeDimension(str, Enum):
    INGREDIENT = 'ingredient'
    HEALTH = 'health'
    TASTE = 'taste'
    COST = 'cost'
    EFFORT = 'effort'
    NOVELTY = 'novelty'
    PORTION = 'portion'
    TIMING = 'timing'

class MappingStatus(str, Enum):
    MAPPED = 'MAPPED'
    AMBIGUOUS = 'AMBIGUOUS'
    UNSUPPORTED = 'UNSUPPORTED'
