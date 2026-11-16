# Stable local API contract — version 1

This is a **new service contract**, not an existing R1 API. JSON uses UTF-8. Successful requests return HTTP 200; errors return `{"error":{"code":"CODE"}}`, sometimes with an `action` explanation. Every POST requires `Content-Type: application/json` and `Idempotency-Key` (1–128 characters). The same key is scoped to the operation/session. Reusing it with a different JSON payload returns 409. All updates also require the last returned `expected_revision`. Unknown request fields are rejected. Numeric JSON values must be finite.

The service listens only on 127.0.0.1. Its permission boundary is the local operator, optionally protected by `DEMO_API_TOKEN`; it has no multi-user accounts or per-user authorization. A frontend must not treat a session ID as a security token. Public hosting requires the Phase 10 release gate. The backend receives structured feedback, never free-form text to be inferred as a reaction. Changing constraints/policy/backend starts a new scenario.

## Endpoint ledger

| Endpoint | Request | Success response | State/persistence | Endpoint-specific errors |
|---|---|---|---|---|
| GET `/v1/capabilities` | No body | Capability object below | Read-only; reflects configured assets/mode | 503 startup prevents serving corrupt assets |
| GET `/v1/recipes/{id}` | Exact recipe ID as URL path component | `RecipeItem` JSON, all nullable catalog metadata retained | Read-only catalog lookup, no remote image download | 404 RECIPE_NOT_FOUND |
| POST `/v1/sessions` | `CreateSession` below | `SessionResponse` | Atomic creation + idempotent response, revision 0 | 422 UNKNOWN_POLICY, TRAJECTORY_FIXTURE_REQUIRED, BACKEND_FIXTURE_MISMATCH, INVALID_REQUEST |
| GET `/v1/sessions/{id}` | No body | `SessionResponse` | Read-only, no prediction/update | 404 NOT_FOUND |
| POST `/v1/sessions/{id}/recommendations` | `{"expected_revision": integer}` | `SessionResponse` with pending action | Atomic pending forecast + adapter pending state + revision+1. Existing pending action returned without predicting again | 409 STALE_REVISION, SESSION_CLOSED, HORIZON_REACHED, RECORDED_CONTEXT_UNAVAILABLE, PROVIDER_UNKNOWN_COMPLETION; 422 NO_SAFE_RECOMMENDATION |
| POST `/v1/sessions/{id}/feedback` | `Feedback` below | `SessionResponse` with cleared pending action | One atomic reveal/transition/history/update, revision+1; cancellation closes without reveal | 409 PENDING_RECOMMENDATION_MISMATCH, STALE_REVISION, SESSION_CLOSED; 422 HUMAN_REACTION_REQUIRED, SYNTHETIC_REACTION_IS_ENGINE_OWNED, CLOSE_CANNOT_REVEAL |
| POST `/v1/branch-comparisons` | `Compare` below | `ComparisonResponse` | Synchronous job, root pinned at supplied revision, separate immutable job record and idempotent response; no factual update | 422 TWO_DISTINCT_KNOWN_POLICIES_REQUIRED, HUMAN_ORACLE_UNAVAILABLE, INSUFFICIENT_HORIZON; 409 PENDING_ROOT_REQUIRED, STALE_REVISION, missing recorded/unknown completion |
| GET `/v1/branch-comparisons/{id}` | No body | Same persisted `ComparisonResponse` | No recomputation, provider call or factual update | 404 NOT_FOUND |
| GET `/v1/reference-results/r1` | No body | Historical results object below | Immutable asset reads | Asset verification fails startup; no new analysis runs |

Common errors: 400 IDEMPOTENCY_KEY_REQUIRED / TRANSFER_ENCODING_UNSUPPORTED; 401 UNAUTHORIZED when bearer token configured; 403 ORIGIN_DENIED; 405 METHOD_NOT_ALLOWED; 413 BODY_SIZE; 415 JSON_REQUIRED; 422 JSON_OBJECT_REQUIRED / INVALID_REQUEST; 409 IDEMPOTENCY_CONFLICT / PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE; 503 ASSET_INTEGRITY_FAILURE. Internal unexpected errors return 500 INTERNAL_ERROR without leaking exception/secret content. Missing scientific assets are never repaired by an API request.

## Request schemas

`CreateSession` is the exact Pydantic schema in `domain/service.py`:

| Field | Type/default | Meaning |
|---|---|---|
| world_kind | required `human_interaction` or `synthetic_simulation` | Controls authority for feedback and private evaluation |
| policy | string; `deterministic_recipe_recommendation` | One of the four exact policy identifiers in capabilities |
| prediction_backend | structured or agenda backend identifier; structured default | Frozen bundle and synthetic outcome mechanism, fixed for scenario |
| predictor | `population`, `class_bias`, `contextual`; population default | Scenario-owned predictor state |
| persona | `UserPersona` or null | Required for human, forbidden for synthetic; human baseline_traits must be empty |
| initial_state | `ResearchInitialState` or null | Human: explicit bounded settings, else six .5 values; synthetic always fixture state |
| request | nonempty string ≤600; default safe recipe request | Human request fixed for scenario; synthetic uses fixture context |
| fixture | basename of a copied `trajectory_*.json` or null | Required for synthetic; forbidden for human |
| segments | integer 1–4; default 2 | Human horizon; synthetic uses fixture plan |
| turns_per_segment | integer 1–12; default 6 | Human horizon; synthetic uses fixture plan |

Synthetic `policy` is the requested new interactive policy, with fixture profile/initial state/context/plan. The API gives it a new scenario identity and namespace. It is **not exact R1 replay**. Exact recorded replay remains the scientific parity runner. Synthetic `request`, `segments` and `turns_per_segment` do not override the curated scenario; the returned plan/request are authoritative. Avoid sending those optional fields for synthetic creation.

`Feedback`: required integer expected_revision ≥0; operation `feedback` (default), `cancel` or `close`; recommendation_id string/null; reaction one of four research labels/null; continuation CONTINUE (default) or DISENGAGE; requested_changes array of `RequestedChange` (default empty). A requested change requires instruction or residual text, with optional typed dimensions. Human feedback requires reaction and the pending ID. Synthetic feedback requires pending ID but forbids supplied reaction/requested changes/nondefault continuation. Close/cancel accepts no reaction/change; if pending, it records cancellation and discards uncommitted contextual pending state. Both are terminal in this minimal service.

`Compare`: expected_revision ≥0, session_id, exactly two distinct policy IDs, allocator `equal|greedy|uncertainty|pcub` (default pcub), budget `2|4|8|12` (default 8), oracle boolean (default false). The application canonicalizes pair order to the scientific order. Human oracle=true is rejected. No frontend may submit probabilities, P/U/D/C values, hidden tendencies or oracle values.

## Response schemas

`SessionResponse` has these exact fields:

| Field | Schema |
|---|---|
| id | UUID string identifying the whole new scenario |
| world_kind / policy / backend / predictor | Fixed creation choices as above |
| revision | Integer, increases once per committed state-changing command |
| status | `open` or `closed` |
| plan | `{number_of_sessions: int, turns_per_session: int}` |
| persona | Exact public `UserPersona` JSON, including declared hard constraints |
| request | Fixed observable request |
| state | `ResearchInitialState` JSON |
| history | Ordered `HistoryEntry[]`, completed only |
| pending | Null or `PendingRecommendation` below |
| cancelled | Ordered cancelled `PendingRecommendation[]` |
| evidence | Ordered `{forecast: PendingRecommendation, outcome: HumanOutcome or AuthoritativeOutcome, provenance: Provenance}` records |
| reference_run_fingerprint | Always null for interactive sessions |
| claim | Fixed explanation that this is interactive engineering simulation, not historical R1 evidence or measured human psychology |

`PendingRecommendation`: id (observation-style position ID), recommendation (`RecommendationAgentOutput`), predictor_input (`PredictorInput`, contains no current label), probabilities (four floats in research class order), provenance (`Provenance`), source_decision_fingerprint (null or guarded request SHA), conformal_reference (meaning string, population_probabilities and method→coverage→ordered class-set mapping), asset_manifest_fingerprint. `recommendation.ranked_recipe_ids` is a ranking, never a probability vector. `recommendation.rationale` is provenance, not an instruction to the frontend.

`Provenance`: world_kind, reaction_origin (`null`, human_submission, synthetic_generated, recorded_synthetic, hypothetical), evidence_status (pending/factual/counterfactual), recommendation_execution_mode (deterministic/recorded_guarded/live_guarded), reference_run_fingerprint. Only exact reference replay/results may carry an upstream reference fingerprint. The new validation function and A5 matrix encode allowed combinations. A human’s recorded guarded recommendation remains human_interaction. Factual means realized in the declared world, not necessarily human.

`ComparisonResponse`: id, status=complete, session_id, factual_revision, root_id, policies (canonical two `[identifier,version]` pairs), result (`BranchRunResult`), metrics (null without oracle; otherwise `outcome_record` fields), oracle (null or policy_values/best_policy/exact_tie/meaning), provenance, costs, asset_manifest_fingerprint. `result.nodes` contains all selected hypothetical states/actions/probabilities/utilities; `result.expansion_order` preserves exact order. The frontend can render these directly without recomputing PCUB. `metrics` includes root/profile/pair/budget/allocator/selected_policy/oracle_best_policy/regret/best_policy_correct/value_mae/value_rmse/rank_agreement/expanded_first_reaction_count/expanded_depth_counts/branch_policy_recipe_disagreement/estimated_policy_values/oracle_policy_values/oracle_margin/expansions/expansion_order.

Costs separate preparation (reservations, live calls, new tokens, used decision keys and seal), evaluation (live calls=0 after sealing, new tokens=0, expansions), and combined totals. In optional live mode journal-before/after records preserve missing token metadata as null. Cache reuse is not a fresh provider charge. Failed/unknown preparation stays in the durable journal and cannot be hidden by a successful zero-call evaluation claim. The current synchronous API does not return a resumable job handle before completion; see the Phase 10 limit.

Capabilities: api_version, mode, policies, backends, predictors, allocators, budgets, branch_depth, human_oracle, live_guarded, conformal explanation, recorded_guarded limitation, asset_manifest_fingerprint. Historical results: world_kind=reference_replay, upstream freeze fingerprint, formal_closure_present=false, claim and tables named primary_comparison, branch_metrics, longitudinal_metrics, llm_accounting, replay_record. These tables are not recalculated or overwritten by interactive operations.

`PendingRecommendation.provider_costs` additionally reports reservations, live_calls, new_tokens and cache_reuse; optional live mode includes journal_before/journal_after summaries. These are new-request costs, distinct from historical usage attached to a reused recorded decision.

## Complete runnable HTTP example

Run after starting the offline server. This script prints **actual responses** and checks their structural/state promises; no invented UUID, selected recipe or probability vector is presented as an expected output.

```powershell
$Base = 'http://127.0.0.1:8765'
function Post-Demo($Path, $Body, $Key) {
    $Headers = @{ 'Idempotency-Key' = $Key }
    if ($env:DEMO_API_TOKEN) { $Headers.Authorization = 'Bearer ' + $env:DEMO_API_TOKEN }
    Invoke-RestMethod -Method Post -Uri ($Base + $Path) -Headers $Headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 40 -Compress)
}
$Auth = @{}
if ($env:DEMO_API_TOKEN) { $Auth.Authorization = 'Bearer ' + $env:DEMO_API_TOKEN }
$Capabilities = Invoke-RestMethod -Uri "$Base/v1/capabilities" -Headers $Auth
if ($Capabilities.mode -ne 'offline') { throw 'Run this walkthrough in offline mode' }
$Session = Post-Demo '/v1/sessions' @{ world_kind='human_interaction'; predictor='contextual'; persona=@{user_id='walkthrough-user';display_name='Walkthrough';dietary_pattern='omnivore';allergies=@('peanut')};request='Recommend a safe recipe.' } 'walkthrough-create-1'
$SessionPath = '/v1/sessions/' + $Session.id
$Pending = Post-Demo ($SessionPath + '/recommendations') @{expected_revision=$Session.revision} 'walkthrough-recommend-1'
$Recipe = Invoke-RestMethod -Uri ($Base + '/v1/recipes/' + $Pending.pending.recommendation.selected_recipe_id) -Headers $Auth
$Job = Post-Demo '/v1/branch-comparisons' @{session_id=$Session.id;expected_revision=$Pending.revision;policies=@('deterministic_recipe_recommendation','feedback_sequence_recipe_recommendation');allocator='pcub';budget=8;oracle=$false} 'walkthrough-branch-1'
$RetrievedJob = Invoke-RestMethod -Uri ($Base + '/v1/branch-comparisons/' + $Job.id) -Headers $Auth
$FeedbackBody = @{expected_revision=$Pending.revision;recommendation_id=$Pending.pending.id;reaction='ACCEPT';continuation='CONTINUE'}
$Done = Post-Demo ($SessionPath + '/feedback') $FeedbackBody 'walkthrough-feedback-1'
$Duplicate = Post-Demo ($SessionPath + '/feedback') $FeedbackBody 'walkthrough-feedback-1'
if ($Done.revision -ne $Duplicate.revision -or $Done.history.Count -ne 1) { throw 'Exactly-once feedback failed' }
$Fetched = Invoke-RestMethod -Uri ($Base + $SessionPath) -Headers $Auth
$Historical = Invoke-RestMethod -Uri "$Base/v1/reference-results/r1" -Headers $Auth
if ($Historical.formal_closure_present) { throw 'Historical closure must not be invented' }
$Fetched | ConvertTo-Json -Depth 50
$RetrievedJob | ConvertTo-Json -Depth 50
```

Restart the server with the same database and GET the same session/job IDs; their contents must remain. Reusing walkthrough keys returns the original results, so use a fresh key prefix for a genuinely new walkthrough. Automated integration coverage is `tests.test_service.Service.test_http_contract` plus lifecycle tests. No frontend code is required for this checkpoint.
