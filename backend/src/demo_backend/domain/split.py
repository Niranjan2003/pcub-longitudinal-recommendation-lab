from __future__ import annotations
from enum import Enum

class ResearchSplit(str, Enum):
    TRAIN = 'TRAIN'
    DEVELOPMENT = 'DEVELOPMENT'
    CALIBRATION = 'CALIBRATION'
    TEST = 'TEST'
