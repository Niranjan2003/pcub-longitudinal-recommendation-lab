from __future__ import annotations
import random
from typing import Any
from demo_backend.domain.canonical import fingerprint

def stable_seed(*parts: Any) -> int:
    """Return a platform-stable 64-bit seed using the existing canonical hash."""
    digest = fingerprint([str(part) for part in parts])
    return int(digest[:16], 16)

def local_rng(*parts: Any) -> random.Random:
    return random.Random(stable_seed(*parts))
