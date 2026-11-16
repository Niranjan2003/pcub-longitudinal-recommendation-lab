# Observed contract notes

Observations from the **real offline backend** (2026-11-10, `mode: offline`, API v1), compared with the archived
documentation snapshots in `docs/reference/`. Nothing here was changed in the backend; contradictions are reported,
not reconciled. Raw captures: `tests/fixtures/captured/` (engineering captures, not research evidence).

Authority order when sources conflict: current backend source (not inspected) > code reference > master report >
archived API contract.

## Resolved ambiguities (A-items)

| # | Question | Observed answer |
|---|---|---|
| A1 | Top-level session keys | `id, world_kind, policy, backend, predictor, revision, status, plan, persona, request, state, history, pending, cancelled, evidence, reference_run_fingerprint, claim`. (Resolves D1: the key is `world_kind`.) `status` is `open` here; `plan = {number_of_sessions, turns_per_session}`. |
| A2 | `pending` keys | `id, recommendation, predictor_input, probabilities, provenance, source_decision_fingerprint, conformal_reference, asset_manifest_fingerprint, provider_costs`. `provider_costs = {reservations, live_calls, new_tokens, cache_reuse}` (offline: `0,0,0,false`). `conformal_reference = {meaning, population_probabilities[4], sets{method → coverage → [labels]}}` with methods `APS, APS_V1, RAPS, SAPS` and coverages `"0.8","0.9","0.95"`. |
| A3 | Evidence record | `{forecast: <full pending object>, outcome: {reaction, continuation, requested_changes[], source_evidence_ids[], reference_kind}, provenance}` |
| A4 | Provenance keys | `world_kind, reaction_origin, evidence_status, recommendation_execution_mode, reference_run_fingerprint`. Pending: `reaction_origin: null`, `evidence_status: "pending"`. Completed human feedback: `human_submission`, `factual`. Job: `hypothetical`, `counterfactual`. |
| A5 | Capabilities keys | `api_version, mode, policies[], backends[], predictors[], allocators[], budgets[], branch_depth (2), human_oracle (false), live_guarded (false), conformal (text), recorded_guarded (text), asset_manifest_fingerprint`. `policies` are plain strings without versions. (Resolves D2.) |
| A6 | `costs` | `{preparation{live_calls, reservations, new_tokens, unique_recorded_decisions, decision_keys[], decision_manifest_sha256}, evaluation{live_calls, new_tokens, expansions}, combined{live_calls, new_tokens}}` |
| A7 | Oracle keys | Not observed yet (human sessions cannot request an oracle). To be recorded in milestone M-B. |
| A8 | R1 shape | `{world_kind: "reference_replay", reference_run_fingerprint, formal_closure_present: false, claim, tables{primary_comparison, branch_metrics, longitudinal_metrics, llm_accounting, replay_record}}`. Tables are **nested under `tables`**. |
| A9 | Error body | `{"error": {"code": "<CODE>"}}`. No `action` field observed in any probe; it remains optional. |
| A10 | cancel/close | Verified (integration suite). `cancel` with the pending `recommendation_id` → `status: closed`, pending moved to `cancelled[]`, no history/evidence, state unchanged. `close` with no pending and no `recommendation_id` → closed, revision +1. A closed session rejects further commands with `SESSION_CLOSED`. |
| A11 | RequestedChange | `{schema_version: "pcub_requested_change_v1", dimensions[], instruction, residual_text}`. An instruction-only change was accepted. |
| A12 | Human `initial_state` | Omitting it yields six `0.5` scalars plus `specification_version: "pcub_initial_state_v1"` and empty lists. The six-scalar-only form is accepted and echoed (verified). |
| A13 | Branch node id | `<root_id>:d1:<REACTION>` and `<root_id>:d2:<R1>><R2>`, with `root_id = <session_id>:s01:t01`. `parent_node_id` is `null` at depth 1 and the depth-1 node id at depth 2. |

## Other observations

* **Recipe**: the id key is `recipe_id`. `image_url` is `null` (no images will be shown). `recipe_url` is a genuine
  source-site link. `dietary_labels` and `allergens` are empty lists in this catalog subset; the safety filter relies
  on ingredient/title/tag text.
* **Idempotent replay** returns the stored canonical JSON: values are identical to the original response, but key
  order differs (sorted). Clients must compare by value, not by string.
* **Branch node display probability** (`calibrated_reaction_probability`) is the paired mean of the two policies'
  step probabilities; each policy's own probabilities are in `policy_evidence[i]`. `cloned_dynamic_state` on a node
  is the state after applying that node's reaction (first policy's state).
* **Costs semantics**: `result.llm_calls` / `llm_tokens` are engine-logical counters and are `0` even when the
  preparation pass records provider work; provider cost lives only in `costs`.
* **Engine version string**: `paired_v2_branch_engine` / `pcub_v2_paired_branch_engine_v1` observed (resolves D6).
* **Recommendation count in `recommender_calls`** includes the two root recommendations (18 for a budget-8 run).
* **Expansion order** observed for budget 8: `d1:MODIFY_CLARIFY, d1:ACCEPT, d2:M>M, d2:A>M, d1:DEFER, d2:D>M, d2:A>A, d2:M>D`.

## Backend behaviours that differ from the documentation (reported, not worked around)

* **B1 — missing synthetic fixture returns 500.** `POST /v1/sessions` with
  `{"world_kind":"synthetic_simulation","fixture":"definitely_missing.json"}` returned `HTTP 500 INTERNAL_ERROR`,
  whereas the documentation implies an `INVALID_REQUEST`/`TRAJECTORY_FIXTURE_REQUIRED`-style 422. The frontend avoids
  this by only ever sending operator-verified fixture basenames (never guessed names), and displays any 500 verbatim.

## Verified lifecycle behaviours (real offline backend, `tests/integration/human_lifecycle.test.ts`)

* create → revision 0; recommend → revision 1 with a pending forecast and **no history entry**; feedback → revision 2
  with exactly one history entry. The forecast stored in `evidence[i].forecast` equals the pending forecast that existed
  before the reveal.
* Same-key replay of recommend/feedback returns the same revision (exactly-once); the same key with a different body
  → `409 IDEMPOTENCY_CONFLICT`; an old `expected_revision` → `409 STALE_REVISION` and nothing changes.
* A second recommend request (new key, same revision) returns the existing pending action unchanged.
* Segment rollover: with `turns_per_segment: 2`, the 3rd completed turn has `position.session_index: 2, turn_index: 1`;
  history and state carry over. Exhausting the horizon closes the session. Human `DISENGAGE` records the reaction and
  closes.
* Requested changes are accepted with any reaction (observed with ACCEPT).
* Impossible hard constraints → `422 NO_SAFE_RECOMMENDATION`, revision stays 0, nothing pending.
* Offline guarded policy on a new scenario → `409 RECORDED_CONTEXT_UNAVAILABLE`, nothing pending, policy not switched.
  No provider path was involved (backend `mode: offline`).
* `population` predictor: `pending.probabilities` equals `conformal_reference.population_probabilities` exactly.
* Both simulator backends (`current_structured_simulator@1`, `usersimcrs_agenda_derived@1`) can host a human session.

## Synthetic worlds and the oracle (verified 2026-11-10, `tests/integration/synthetic_capture.test.ts`)

* **Verified fixtures** (see `src/config/syntheticPresets.ts`): both exist and work with their own simulator backend:
  `trajectory_pcub-v3-current_structured_simulator@1-pcub-v1-pcub-profile-0002-23d45e44-deterministic_recipe_recommendation-v1.json`
  and the `usersimcrs_agenda_derived@1` counterpart following the same pattern. Using a fixture with the other backend →
  `422 BACKEND_FIXTURE_MISMATCH`. Both give revision 0, plan 2×6, `reference_run_fingerprint: null`, and a persona,
  request and initial state owned by the fixture (`baseline_traits: {source: "pcub_profile_v1"}` is present on the persona).
* **Synthetic advance** sends only `{expected_revision, operation: "feedback", recommendation_id}`. A supplied reaction →
  `422 SYNTHETIC_REACTION_IS_ENGINE_OWNED` (nothing committed).
* **Synthetic outcome** (`evidence[i].outcome`) carries, beyond the human shape: `reference_kind: "independent_synthetic"`,
  `synthetic_reference{identifier, version}`, `sample_provenance{root_seed, simulation_seed_namespace,
  seed_derivation_version, derived_seed, reaction_draw, continuation_draw}`, `outcome_probabilities{ACCEPT,…}`,
  `continuation_probability`, `generation_reason_codes[]`. The agenda simulator's vector is one-hot with null draws.
  Provenance: `synthetic_simulation / synthetic_generated / factual`.
* **D8 resolved:** a synthetic `DISENGAGE` is recorded but does **not** close the session (verified over 4 turns).
* **Oracle** (`comparison.oracle`): `{policy_values{policy→number}, best_policy, exact_tie, meaning}` with `meaning` =
  "synthetic-model reference; never human ground truth". Independent of allocator and budget (same values at budget 2
  with `equal` and budget 8 with `greedy`).
* **Metrics** (`comparison.metrics`): `root, profile, pair[2], budget, allocator, selected_policy, oracle_best_policy,
  regret, best_policy_correct, value_mae, value_rmse, rank_agreement, expanded_first_reaction_count,
  expanded_depth_counts, branch_policy_recipe_disagreement, estimated_policy_values, oracle_policy_values,
  oracle_margin, expansions, expansion_order`. Verified internally consistent: `best_policy_correct == (regret ≤ 1e-12)`,
  `regret == max(oracle values) − oracle[selected]`, and `estimated_policy_values` equals `result.estimated_policy_values`.
* With `oracle: false` on a synthetic session, `oracle` and `metrics` are `null`.
* **Adverse case observed:** on the agenda simulator the PCUB limited selection disagreed with the oracle
  (`best_policy_correct: false`, regret ≈ 0.072); on the structured simulator it agreed (regret 0). Both are rendered with
  equal prominence.

## Live mode (observed 2026-11-15 against the unmodified backend with the fake-provider harness)

* Capabilities: `mode: "live_opt_in"`, `live_guarded: true`; the harness alone adds `provider_transport`,
  `fake_provider_calls` and `fake_live_call_limit`.
* `pending.provider_costs` additionally carries `journal_before` and `journal_after`:
  `{reservations, completed_responses, unknown, records[{key, usage{input_tokens, output_tokens, total_tokens} | null,
  latency_seconds | null}]}`. These are whole-journal snapshots; the record for this recommendation is the one whose
  `key` equals `source_decision_fingerprint`. Deterministic policies get no snapshots.
* A new guarded context: `recommendation_execution_mode: "live_guarded"`, `reservations = live_calls = 1`,
  `cache_reuse: false`, `new_tokens` = that record's `total_tokens`. An identical later context (same persona, request,
  state and position): `live_guarded`, `live_calls: 0`, `new_tokens: 0`, `cache_reuse: true`, same fingerprint and
  ranking. A recorded context (structured synthetic fixture, turn 1): `recorded_guarded`, no request.
* An invalid provider answer: `live_guarded`, one request, rationale `fallback=True`.
* Uncertain transport outcome: `409 PROVIDER_UNKNOWN_COMPLETION` with an `action` text; the same context then fails the
  same way without any request. Limit reached: `409 PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE` before any request.
* Deterministic-pair comparisons in live mode report `costs.preparation.journal_before/after` and zero live calls.

## Still open (recorded as they are resolved)

* Guarded policy on a synthetic session offline: either an exact recorded decision or `RECORDED_CONTEXT_UNAVAILABLE`; the
  integration test accepts both and logs which occurred.

## Verified comparison behaviours (`tests/integration/comparison.test.ts`)

* All 4 allocators × budgets 2/4/8/12 run from one human root: `actual_expansions == budget`, `expansion_order` and
  `nodes` have equal length with identical id sets, every depth-2 node's parent was expanded earlier, max depth 2.
  `allocator_id` values: `equal_round_robin`, `greedy_highest_probability`, `uncertainty_first`,
  `pcub_probability_uncertainty_disagreement`.
* Comparisons never change the factual session (value-identical before/after 16 jobs). GET of a job equals the POST
  response. Same root + params with a new key gives a new job id but identical estimates and expansion order.
* The backend canonicalizes pair order (`[FB, DET]` requested → `[DET, FB]` returned).
* Errors: no pending → `409 PENDING_ROOT_REQUIRED`; old revision → `409 STALE_REVISION`; `oracle:true` for a human
  session → `422 HUMAN_ORACLE_UNAVAILABLE`; identical policies → `422 TWO_DISTINCT_KNOWN_POLICIES_REQUIRED`; budget
  outside {2,4,8,12} → `422 INVALID_REQUEST`; offline guarded pair → `409 RECORDED_CONTEXT_UNAVAILABLE`.
* `INSUFFICIENT_HORIZON` threshold (1 segment, root at turn 1): total horizon 1 or 2 turns → `422
  INSUFFICIENT_HORIZON`; 3 or 4 turns → succeeds (root plus two further positions needed).
