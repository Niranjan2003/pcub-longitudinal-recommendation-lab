from __future__ import annotations
from dataclasses import dataclass
import math
import numpy as np
from demo_backend.prediction.population import validate_probabilities
import demo_backend.uncertainty.aps as v1

@dataclass(frozen=True)
class ConformalMethod:
    name: str
    weight: float = 0.1
    k_reg: int = 2

    def __post_init__(self):
        if self.name not in {'APS_V1', 'APS', 'RAPS', 'SAPS'}:
            raise ValueError('Unknown method')
        if not math.isfinite(self.weight) or self.weight < 0 or (self.name == 'SAPS' and self.weight == 0):
            raise ValueError('Invalid regularization weight')
        if not isinstance(self.k_reg, int) or not 0 <= self.k_reg <= 4:
            raise ValueError('Invalid regularization rank')

    def scores(self, probabilities, u=1.0):
        p = validate_probabilities(np.asarray(probabilities, dtype=float))
        if not math.isfinite(u) or not 0 <= u <= 1:
            raise ValueError('u must be in [0,1]')
        order = v1.deterministic_order(p)
        ordered = p[order]
        rank = np.arange(1, 5)
        if self.name == 'APS_V1':
            values = np.cumsum(ordered)
        elif self.name == 'SAPS':
            values = ordered[0] + self.weight * (rank - 2 + u)
            values[0] = u * ordered[0]
        else:
            values = np.cumsum(ordered) - (1 - u) * ordered
            if self.name == 'RAPS':
                values = values + self.weight * np.maximum(rank - self.k_reg, 0)
        result = np.empty(4)
        result[order] = values
        return result

    def calibrate(self, scores, coverage):
        values = np.asarray(scores, dtype=float)
        if values.ndim != 1 or len(values) == 0 or (not np.all(np.isfinite(values))):
            raise ValueError('Finite nonempty scores required')
        if not 0 < coverage < 1:
            raise ValueError('Coverage must be in (0,1)')
        if self.name == 'APS_V1':
            return v1.conformal_threshold(values, coverage)[0]
        rank = math.ceil((len(values) + 1) * coverage)
        return math.inf if rank > len(values) else float(np.sort(values)[rank - 1])

    def prediction_set(self, probabilities, threshold, u=1.0):
        if math.isnan(threshold) or threshold < 0:
            raise ValueError('Invalid threshold')
        p = validate_probabilities(np.asarray(probabilities, dtype=float))
        if self.name == 'APS_V1':
            return v1.prediction_set(p, threshold)
        scores = self.scores(p, u)
        return tuple((int(i) for i in v1.deterministic_order(p) if scores[i] <= threshold))
