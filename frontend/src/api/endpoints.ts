import type { ZodType } from 'zod';
import { getJson } from './client';
import { ApiError } from './errors';
import { runCommand, type CommandResult } from './commands/runCommand';
import {
  buildCompare,
  buildCreateHumanSession,
  buildCreateSyntheticSession,
  buildEndSession,
  buildSyntheticAdvance,
  buildHumanFeedback,
  buildRecommend,
  type CompareInput,
  type CreateHumanSessionInput,
  type CreateSyntheticSessionInput,
  type RequestedChangeInput,
} from './requests';
import {
  capabilitiesSchema,
  comparisonSchema,
  recipeSchema,
  referenceResultsSchema,
  sessionSchema,
  type Capabilities,
  type Comparison,
  type Continuation,
  type Reaction,
  type Recipe,
  type ReferenceResults,
  type Session,
} from './schemas';

/**
 * The nine supported endpoints, and nothing else. Reads validate responses;
 * commands go through runCommand (key + journal + classification, no retry).
 */

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  throw new ApiError({ kind: 'contract', message: 'The backend response did not match the expected contract', raw: body, issues: r.error.issues });
}

/* 1 */ export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return parse(capabilitiesSchema, await getJson('/v1/capabilities', signal));
}

/* 2 */ export async function getRecipe(id: string, signal?: AbortSignal): Promise<Recipe> {
  return parse(recipeSchema, await getJson(`/v1/recipes/${encodeURIComponent(id)}`, signal));
}

/* 4 */ export async function getSession(id: string, signal?: AbortSignal): Promise<Session> {
  return parse(sessionSchema, await getJson(`/v1/sessions/${encodeURIComponent(id)}`, signal));
}

/* 8 */ export async function getComparison(id: string, signal?: AbortSignal): Promise<Comparison> {
  return parse(comparisonSchema, await getJson(`/v1/branch-comparisons/${encodeURIComponent(id)}`, signal));
}

/* 9 */ export async function getReferenceResultsR1(signal?: AbortSignal): Promise<ReferenceResults> {
  return parse(referenceResultsSchema, await getJson('/v1/reference-results/r1', signal));
}

/* 3 */ export function createHumanSession(
  input: CreateHumanSessionInput,
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'create_session',
    path: '/v1/sessions',
    body: buildCreateHumanSession(input),
    schema: sessionSchema,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 3 (synthetic) */ export function createSyntheticSession(
  input: CreateSyntheticSessionInput,
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'create_session',
    path: '/v1/sessions',
    body: buildCreateSyntheticSession(input),
    schema: sessionSchema,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 6 (synthetic: engine-owned reaction) */ export function advanceSynthetic(
  session: Pick<Session, 'id' | 'revision'>,
  recommendationId: string,
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'feedback',
    path: `/v1/sessions/${encodeURIComponent(session.id)}/feedback`,
    body: buildSyntheticAdvance({ expectedRevision: session.revision, recommendationId }),
    schema: sessionSchema,
    sessionId: session.id,
    expectedRevision: session.revision,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 5 */ export function recommend(session: Pick<Session, 'id' | 'revision'>, ctx: { assetFingerprint?: string } = {}): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'recommend',
    path: `/v1/sessions/${encodeURIComponent(session.id)}/recommendations`,
    body: buildRecommend(session.revision),
    schema: sessionSchema,
    sessionId: session.id,
    expectedRevision: session.revision,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 6 */ export function submitHumanFeedback(
  session: Pick<Session, 'id' | 'revision'>,
  input: { recommendationId: string; reaction: Reaction; continuation: Continuation; requestedChanges: RequestedChangeInput[] },
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'feedback',
    path: `/v1/sessions/${encodeURIComponent(session.id)}/feedback`,
    body: buildHumanFeedback({ expectedRevision: session.revision, ...input }),
    schema: sessionSchema,
    sessionId: session.id,
    expectedRevision: session.revision,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 6 (cancel / close; terminal) */ export function endSession(
  session: Pick<Session, 'id' | 'revision' | 'pending'>,
  operation: 'cancel' | 'close',
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Session>> {
  return runCommand({
    command: 'end_session',
    path: `/v1/sessions/${encodeURIComponent(session.id)}/feedback`,
    body: buildEndSession({ expectedRevision: session.revision, operation, recommendationId: session.pending?.id }),
    schema: sessionSchema,
    sessionId: session.id,
    expectedRevision: session.revision,
    assetFingerprint: ctx.assetFingerprint,
  });
}

/* 7 */ export function runComparison(
  session: Pick<Session, 'id' | 'revision' | 'world_kind'>,
  input: Omit<CompareInput, 'session_id' | 'expected_revision'>,
  ctx: { assetFingerprint?: string } = {},
): Promise<CommandResult<Comparison>> {
  if (session.world_kind === 'reference_replay') throw new Error('Not an interactive session');
  return runCommand({
    command: 'compare',
    path: '/v1/branch-comparisons',
    body: buildCompare({ ...input, session_id: session.id, expected_revision: session.revision }, session.world_kind),
    schema: comparisonSchema,
    sessionId: session.id,
    expectedRevision: session.revision,
    assetFingerprint: ctx.assetFingerprint,
  });
}
