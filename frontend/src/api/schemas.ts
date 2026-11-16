import { z } from 'zod';

/**
 * Response schemas, derived from the API contract and verified against real
 * offline-backend responses (tests/fixtures/captured, see
 * docs/OBSERVED_CONTRACT_NOTES.md).
 *
 * Every object is "loose": unknown fields are preserved and visible through
 * the Raw JSON disclosures. Known fields are required and typed; a mismatch
 * becomes a visible "contract mismatch" state rather than a silent partial
 * render. Nothing here is computed or defaulted.
 */

export const REACTIONS = ['ACCEPT', 'MODIFY_CLARIFY', 'DEFER', 'REJECT'] as const;
export const reactionSchema = z.enum(REACTIONS);
export type Reaction = z.infer<typeof reactionSchema>;

export const continuationSchema = z.enum(['CONTINUE', 'DISENGAGE']);
export type Continuation = z.infer<typeof continuationSchema>;

export const CHANGE_DIMENSIONS = ['ingredient', 'health', 'taste', 'cost', 'effort', 'novelty', 'portion', 'timing'] as const;
export const changeDimensionSchema = z.enum(CHANGE_DIMENSIONS);
export type ChangeDimension = z.infer<typeof changeDimensionSchema>;

export const worldKindSchema = z.enum(['human_interaction', 'synthetic_simulation', 'reference_replay']);
export type WorldKind = z.infer<typeof worldKindSchema>;

export const provenanceSchema = z.looseObject({
  world_kind: worldKindSchema,
  reaction_origin: z.enum(['human_submission', 'synthetic_generated', 'recorded_synthetic', 'hypothetical']).nullable(),
  evidence_status: z.enum(['pending', 'factual', 'counterfactual']),
  recommendation_execution_mode: z.enum(['deterministic', 'recorded_guarded', 'live_guarded']),
  reference_run_fingerprint: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/* ---------------------------------------------------------------- capabilities */

export const capabilitiesSchema = z.looseObject({
  api_version: z.string(),
  mode: z.string(),
  policies: z.array(z.string()),
  backends: z.array(z.string()),
  predictors: z.array(z.string()),
  allocators: z.array(z.string()),
  budgets: z.array(z.number()),
  // Documented in the contract but truncated in the code reference (discrepancy D2): optional.
  branch_depth: z.number().optional(),
  human_oracle: z.boolean().optional(),
  live_guarded: z.boolean().optional(),
  conformal: z.string().optional(),
  recorded_guarded: z.string().optional(),
  asset_manifest_fingerprint: z.string(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/* ---------------------------------------------------------------------- recipe */

export const recipeSchema = z.looseObject({
  recipe_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  ingredients: z.array(z.string()),
  directions: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  recipe_url: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  total_time_minutes: z.number().nullable().optional(),
  servings: z.number().nullable().optional(),
  calories_per_serving: z.number().nullable().optional(),
  protein_per_serving_g: z.number().nullable().optional(),
  sodium_per_serving_mg: z.number().nullable().optional(),
  carbohydrate_per_serving_g: z.number().nullable().optional(),
  totalfat_per_serving_g: z.number().nullable().optional(),
  fiber_per_serving_g: z.number().nullable().optional(),
  sugars_per_serving_g: z.number().nullable().optional(),
  health_score: z.number().nullable().optional(),
  health_score_source: z.string().nullable().optional(),
  nutri_score: z.number().nullable().optional(),
  fsa_score: z.number().nullable().optional(),
  who_score: z.number().nullable().optional(),
  ingredient_count: z.number().nullable().optional(),
  instruction_count: z.number().nullable().optional(),
  average_rating: z.number().nullable().optional(),
  number_of_ratings: z.number().nullable().optional(),
  dataset_name: z.string().nullable().optional(),
  dietary_labels: z.array(z.string()).optional(),
  allergens: z.array(z.string()).optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;

/* --------------------------------------------------------------- shared pieces */

export const versionedRefSchema = z.looseObject({
  identifier: z.string(),
  version: z.string(),
  fingerprint: z.string().nullable(),
});

export const selectedItemSchema = z.looseObject({
  item_id: z.string(),
  title: z.string(),
  ingredients: z.array(z.string()),
  dataset: versionedRefSchema,
  known_constraints: z.array(z.string()),
});

export const actionSchema = z.looseObject({
  action_id: z.string(),
  action_type: z.string(),
  selected_item: selectedItemSchema,
  explanation: z.string(),
  grounding: z.array(z.string()),
});
export type Action = z.infer<typeof actionSchema>;

export const requestedChangeSchema = z.looseObject({
  schema_version: z.string().optional(),
  dimensions: z.array(changeDimensionSchema),
  instruction: z.string().nullable().optional(),
  residual_text: z.string().nullable().optional(),
});
export type RequestedChange = z.infer<typeof requestedChangeSchema>;

export const stateSchema = z.looseObject({
  specification_version: z.string().optional(),
  trust: z.number(),
  motivation: z.number(),
  fatigue: z.number(),
  satisfaction: z.number(),
  engagement: z.number(),
  resistance: z.number(),
  recent_preferences: z.array(z.string()),
  avoided_recently: z.array(z.string()),
  notes: z.array(z.string()),
});
export type DynamicState = z.infer<typeof stateSchema>;
export const STATE_DIMENSIONS = ['trust', 'motivation', 'fatigue', 'satisfaction', 'engagement', 'resistance'] as const;
export type StateDimension = (typeof STATE_DIMENSIONS)[number];

export const personaSchema = z.looseObject({
  user_id: z.string(),
  display_name: z.string(),
  dietary_pattern: z.string(),
  health_goals: z.array(z.string()),
  taste_preferences: z.array(z.string()),
  allergies: z.array(z.string()),
  excluded_ingredients: z.array(z.string()),
  max_total_time_minutes: z.number().nullable(),
  max_ingredient_count: z.number().nullable(),
  max_instruction_count: z.number().nullable(),
  min_servings: z.number().nullable(),
  max_servings: z.number().nullable(),
});
export type Persona = z.infer<typeof personaSchema>;

/* ------------------------------------------------------------------- session */

export const conformalReferenceSchema = z.looseObject({
  meaning: z.string(),
  population_probabilities: z.array(z.number()).length(4),
  /** method → coverage → label set (labels as returned; sets may be empty) */
  sets: z.record(z.string(), z.record(z.string(), z.array(reactionSchema))),
});

/**
 * Whole provider-journal accounting, present only when the backend runs in live
 * mode (snapshots before and after the command). Usage values are the
 * provider's own token counts; null means not reported, never zero.
 */
export const journalAccountingSchema = z.looseObject({
  reservations: z.number(),
  completed_responses: z.number(),
  unknown: z.number(),
  records: z.array(
    z.looseObject({
      key: z.string(),
      usage: z
        .looseObject({ input_tokens: z.number().nullable(), output_tokens: z.number().nullable(), total_tokens: z.number().nullable() })
        .nullable(),
      latency_seconds: z.number().nullable(),
    }),
  ),
});
export type JournalAccounting = z.infer<typeof journalAccountingSchema>;

export const providerCostsSchema = z.looseObject({
  reservations: z.number().nullable(),
  live_calls: z.number().nullable(),
  new_tokens: z.number().nullable(),
  cache_reuse: z.union([z.boolean(), z.number()]).nullable(),
  journal_before: journalAccountingSchema.optional(),
  journal_after: journalAccountingSchema.optional(),
});
export type ProviderCosts = z.infer<typeof providerCostsSchema>;

export const recommendationSchema = z.looseObject({
  turn_index: z.number(),
  selected_recipe_id: z.string(),
  ranked_recipe_ids: z.array(z.string()),
  rationale: z.string(),
  nudge_text: z.string().nullable(),
  constraint_violations: z.array(z.string()),
  constraint_evidence: z.record(z.string(), z.string()),
});

export const pendingSchema = z.looseObject({
  id: z.string(),
  recommendation: recommendationSchema,
  predictor_input: z.looseObject({
    position: z.looseObject({ session_index: z.number(), turn_index: z.number() }),
    action: actionSchema,
  }),
  probabilities: z.array(z.number()).length(4),
  provenance: provenanceSchema,
  source_decision_fingerprint: z.string().nullable(),
  conformal_reference: conformalReferenceSchema,
  asset_manifest_fingerprint: z.string(),
  provider_costs: providerCostsSchema,
});
export type Pending = z.infer<typeof pendingSchema>;

export const outcomeSchema = z.looseObject({
  reaction: reactionSchema,
  continuation: continuationSchema,
  requested_changes: z.array(requestedChangeSchema),
  source_evidence_ids: z.array(z.string()),
  reference_kind: z.string().optional(),
});
export type Outcome = z.infer<typeof outcomeSchema>;

export const evidenceRecordSchema = z.looseObject({
  forecast: pendingSchema,
  outcome: outcomeSchema,
  provenance: provenanceSchema,
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export const historyEntrySchema = z.looseObject({
  position: z.looseObject({ session_index: z.number(), turn_index: z.number() }),
  action: actionSchema,
  reaction: reactionSchema.nullable(),
  continuation: continuationSchema.nullable(),
  requested_changes: z.array(requestedChangeSchema),
  source_evidence_ids: z.array(z.string()),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const sessionSchema = z.looseObject({
  id: z.string(),
  world_kind: worldKindSchema,
  policy: z.string(),
  backend: z.string(),
  predictor: z.string(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['open', 'closed']),
  plan: z.looseObject({ number_of_sessions: z.number(), turns_per_session: z.number() }),
  persona: personaSchema,
  request: z.string(),
  state: stateSchema,
  history: z.array(historyEntrySchema),
  pending: pendingSchema.nullable(),
  cancelled: z.array(pendingSchema),
  evidence: z.array(evidenceRecordSchema),
  reference_run_fingerprint: z.string().nullable(),
  claim: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

/* ---------------------------------------------------------------- comparison */

export const utilitySchema = z.looseObject({
  state_component: z.number(),
  action_component: z.number(),
  synthetic_branch_utility: z.number(),
});

export const policyEvidenceSchema = z.looseObject({
  policy: versionedRefSchema,
  calibrated_step_probability: z.number(),
  calibrated_cumulative_probability: z.number(),
  downstream_action: actionSchema,
  utility: utilitySchema,
});
export type PolicyEvidence = z.infer<typeof policyEvidenceSchema>;

export const branchNodeSchema = z.looseObject({
  schema_version: z.string(),
  node_id: z.string(),
  parent_node_id: z.string().nullable(),
  depth: z.number().int(),
  hypothetical_reaction: reactionSchema,
  branch_path: z.array(reactionSchema),
  /** Display probability: the paired mean across both policies (per the engine). */
  calibrated_reaction_probability: z.number(),
  cumulative_path_probability: z.number(),
  cloned_dynamic_state: stateSchema,
  permitted_history_summary: z.array(z.string()),
  policy_evidence: z.array(policyEvidenceSchema).length(2),
  expansion_cost: z.looseObject({}),
  engine: versionedRefSchema,
  provenance: z.array(versionedRefSchema),
});
export type BranchNode = z.infer<typeof branchNodeSchema>;

export const branchResultSchema = z.looseObject({
  root_context_id: z.string(),
  allocator_id: z.string(),
  allocator_version: z.string(),
  budget: z.number(),
  actual_expansions: z.number(),
  predictor_calls: z.number(),
  recommender_calls: z.number(),
  llm_calls: z.number(),
  llm_tokens: z.number(),
  expansion_order: z.array(z.string()),
  nodes: z.array(branchNodeSchema),
  estimated_policy_values: z.record(z.string(), z.number()),
  selected_policy: z.string(),
  selected_action: actionSchema,
});
export type BranchResult = z.infer<typeof branchResultSchema>;

const nullableCount = z.number().nullable();
export const costsSchema = z.looseObject({
  preparation: z.looseObject({
    live_calls: nullableCount,
    reservations: nullableCount,
    new_tokens: nullableCount,
    unique_recorded_decisions: z.number().optional(),
    decision_keys: z.array(z.string()).optional(),
    decision_manifest_sha256: z.string().optional(),
  }),
  evaluation: z.looseObject({
    live_calls: nullableCount,
    new_tokens: nullableCount,
    expansions: z.number(),
  }),
  combined: z.looseObject({ live_calls: nullableCount, new_tokens: nullableCount }),
});
export type Costs = z.infer<typeof costsSchema>;

export const comparisonSchema = z.looseObject({
  id: z.string(),
  status: z.literal('complete'),
  session_id: z.string(),
  factual_revision: z.number().int().nonnegative(),
  root_id: z.string(),
  /** Canonical pair as [identifier, version], in the backend's scientific order. */
  policies: z.array(z.tuple([z.string(), z.string()])).length(2),
  result: branchResultSchema,
  /** Null when no oracle was requested. Rendered as "absent", never as zeros. */
  metrics: z.record(z.string(), z.unknown()).nullable(),
  oracle: z.record(z.string(), z.unknown()).nullable(),
  provenance: provenanceSchema,
  costs: costsSchema,
  asset_manifest_fingerprint: z.string(),
});
export type Comparison = z.infer<typeof comparisonSchema>;

/* --------------------------------------------------------- historical R1 */

export const referenceResultsSchema = z.looseObject({
  world_kind: z.literal('reference_replay'),
  reference_run_fingerprint: z.string(),
  formal_closure_present: z.boolean(),
  claim: z.string(),
  tables: z.record(z.string(), z.unknown()),
});
export type ReferenceResults = z.infer<typeof referenceResultsSchema>;
