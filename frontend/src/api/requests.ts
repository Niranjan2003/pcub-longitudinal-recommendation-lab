import { z } from 'zod';
import { changeDimensionSchema, continuationSchema, reactionSchema } from './schemas';

/**
 * Strict request builders. The backend rejects unknown fields and hashes the
 * submitted payload for idempotency, so each command has exactly one canonical
 * form: only allowed fields, no undefined values, stable key order.
 * Builders validate; they never compute scientific values.
 */

const optionalLimit = (min: number) => z.number().finite().min(min).optional();

export const personaInputSchema = z.strictObject({
  user_id: z.string().min(1),
  display_name: z.string().min(1),
  dietary_pattern: z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other']),
  allergies: z.array(z.string().min(1)),
  excluded_ingredients: z.array(z.string().min(1)),
  health_goals: z.array(z.string().min(1)),
  taste_preferences: z.array(z.string().min(1)),
  max_total_time_minutes: z.number().finite().gt(0).optional(),
  max_ingredient_count: optionalLimit(0),
  max_instruction_count: optionalLimit(0),
  min_servings: z.number().finite().gt(0).optional(),
  max_servings: z.number().finite().gt(0).optional(),
});
export type PersonaInput = z.infer<typeof personaInputSchema>;

const unit = z.number().finite().min(0).max(1);
export const initialStateInputSchema = z.strictObject({
  trust: unit,
  motivation: unit,
  fatigue: unit,
  satisfaction: unit,
  engagement: unit,
  resistance: unit,
});
export type InitialStateInput = z.infer<typeof initialStateInputSchema>;

export const createHumanSessionSchema = z.strictObject({
  world_kind: z.literal('human_interaction'),
  policy: z.string().min(1),
  prediction_backend: z.string().min(1),
  predictor: z.string().min(1),
  persona: personaInputSchema,
  initial_state: initialStateInputSchema.optional(),
  request: z.string().min(1).max(600),
  segments: z.number().int().min(1).max(4),
  turns_per_segment: z.number().int().min(1).max(12),
});
export type CreateHumanSessionInput = Omit<z.input<typeof createHumanSessionSchema>, 'world_kind'>;

/** Drop undefined so the serialized body contains only fields the user set. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function buildCreateHumanSession(input: CreateHumanSessionInput) {
  return createHumanSessionSchema.parse(
    compact({
      world_kind: 'human_interaction' as const,
      policy: input.policy,
      prediction_backend: input.prediction_backend,
      predictor: input.predictor,
      persona: compact(input.persona),
      initial_state: input.initial_state,
      request: input.request,
      segments: input.segments,
      turns_per_segment: input.turns_per_segment,
    }),
  );
}

/**
 * Synthetic creation sends ONLY the fixture plus policy/backend/predictor.
 * The fixture owns persona, initial state, request and horizon; none of those
 * (nor segments / turns) may be supplied, so the schema does not allow them.
 */
export const createSyntheticSessionSchema = z.strictObject({
  world_kind: z.literal('synthetic_simulation'),
  policy: z.string().min(1),
  prediction_backend: z.string().min(1),
  predictor: z.string().min(1),
  fixture: z.string().regex(/^trajectory_[^/\\]+\.json$/, 'Fixture must be a trajectory_*.json basename'),
});
export type CreateSyntheticSessionInput = Omit<z.input<typeof createSyntheticSessionSchema>, 'world_kind'>;

export function buildCreateSyntheticSession(input: CreateSyntheticSessionInput) {
  return createSyntheticSessionSchema.parse({ world_kind: 'synthetic_simulation' as const, ...input });
}

/**
 * Synthetic advance: the simulator owns the reaction, so the body carries ONLY
 * the revision and the pending recommendation id. A reaction, requested
 * changes or a non-default continuation are impossible to express here.
 */
export function buildSyntheticAdvance(input: { expectedRevision: number; recommendationId: string }) {
  return z
    .strictObject({
      expected_revision: z.number().int().nonnegative(),
      operation: z.literal('feedback'),
      recommendation_id: z.string().min(1),
    })
    .parse({ expected_revision: input.expectedRevision, operation: 'feedback', recommendation_id: input.recommendationId });
}

export function buildRecommend(expectedRevision: number) {
  return z.strictObject({ expected_revision: z.number().int().nonnegative() }).parse({ expected_revision: expectedRevision });
}

const requestedChangeInputSchema = z
  .strictObject({
    dimensions: z.array(changeDimensionSchema),
    instruction: z.string().min(1).optional(),
    residual_text: z.string().min(1).optional(),
  })
  .refine((c) => c.instruction !== undefined || c.residual_text !== undefined, {
    message: 'A requested change needs an instruction or residual text',
  });
export type RequestedChangeInput = z.input<typeof requestedChangeInputSchema>;

export const humanFeedbackSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  operation: z.literal('feedback'),
  recommendation_id: z.string().min(1),
  reaction: reactionSchema,
  continuation: continuationSchema,
  requested_changes: z.array(requestedChangeInputSchema),
});

export function buildHumanFeedback(input: {
  expectedRevision: number;
  recommendationId: string;
  reaction: z.infer<typeof reactionSchema>;
  continuation: z.infer<typeof continuationSchema>;
  requestedChanges: RequestedChangeInput[];
}) {
  return humanFeedbackSchema.parse({
    expected_revision: input.expectedRevision,
    operation: 'feedback',
    recommendation_id: input.recommendationId,
    reaction: input.reaction,
    continuation: input.continuation,
    requested_changes: input.requestedChanges.map((c) => compact(c)),
  });
}

/**
 * Cancel (while a recommendation is pending) or close. Neither accepts a
 * reaction or changes. Both are terminal. Whether recommendation_id is needed
 * is unconfirmed in the contract (A10); it is sent only when a pending
 * recommendation exists.
 */
export function buildEndSession(input: { expectedRevision: number; operation: 'cancel' | 'close'; recommendationId?: string }) {
  return z
    .strictObject({
      expected_revision: z.number().int().nonnegative(),
      operation: z.enum(['cancel', 'close']),
      recommendation_id: z.string().min(1).optional(),
    })
    .parse(
      compact({
        expected_revision: input.expectedRevision,
        operation: input.operation,
        recommendation_id: input.recommendationId,
      }),
    );
}

export const compareSchema = z.strictObject({
  session_id: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
  policies: z.tuple([z.string().min(1), z.string().min(1)]),
  allocator: z.enum(['equal', 'greedy', 'uncertainty', 'pcub']),
  budget: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(12)]),
  oracle: z.boolean(),
});
export type CompareInput = z.input<typeof compareSchema>;

export function buildCompare(input: CompareInput, worldKind: 'human_interaction' | 'synthetic_simulation') {
  if (worldKind === 'human_interaction' && input.oracle) {
    throw new Error('A human oracle does not exist; oracle must be false for human sessions.');
  }
  if (input.policies[0] === input.policies[1]) {
    throw new Error('Choose two different policies.');
  }
  return compareSchema.parse(input);
}
