# Test fixtures

## `captured/` — engineering captures from the real OFFLINE backend

Responses recorded on 2026-11-10 from a local offline PCUB backend
(`mode: offline`, `live_guarded: false`) while building Milestone A.

* They are **engineering captures used to verify wire shapes**. They are **not
  research evidence** and must never be shown in the UI as results.
* `session_*` and `comparison_*` come from one throwaway human scratch session
  (persona "capture-user", deterministic vs feedback_sequence, PCUB, budget 8).
* `reference_results_r1.json` is the frozen historical aggregate response.
* `error_*.txt` are rejected or read-only probes (no state change).
* `error_fixture_unknown.txt`: a **missing synthetic fixture name returned HTTP 500
  INTERNAL_ERROR**, not a 422 (see `docs/OBSERVED_CONTRACT_NOTES.md`).

## Mock variants

Anything derived from captures to test states a real run cannot cheaply produce
(closed sessions, cancelled items, etc.) is built inside the tests from the
captured shapes, with ids prefixed `mock-`.
