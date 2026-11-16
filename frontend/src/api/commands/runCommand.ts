import type { ZodType } from 'zod';
import { postJson } from '../client';
import { ApiError, PROVIDER_TERMINAL_CODES } from '../errors';
import { CommandJournal, journal as defaultJournal, type JournalEntry } from './journal';
import { newIdempotencyKey, type CommandName } from './keys';

export interface CommandSpec<T> {
  command: CommandName;
  path: string;
  /** Already-validated canonical body object. */
  body: unknown;
  schema: ZodType<T>;
  sessionId?: string;
  expectedRevision?: number;
  assetFingerprint?: string;
}

export interface CommandResult<T> {
  value: T;
  key: string;
  /** True when this value came from a user-initiated same-key recovery replay. */
  replayed: boolean;
}

function parseOrThrow<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError({
    kind: 'contract',
    message: 'The backend response did not match the expected contract',
    raw: body,
    issues: parsed.error.issues,
  });
}

async function send<T>(
  entry: Pick<JournalEntry, 'key' | 'path' | 'body'>,
  schema: ZodType<T>,
  j: CommandJournal,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const res = await postJson(entry.path, entry.key, entry.body, signal);
    // Committed on the backend regardless of whether our schema accepts the body.
    j.settle(entry.key, { state: 'committed', httpStatus: res.status });
    return parseOrThrow(schema, res.body);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.kind === 'backend') {
        const terminal = e.code !== undefined && PROVIDER_TERMINAL_CODES.has(e.code);
        j.settle(entry.key, {
          state: terminal ? 'terminal' : 'rejected',
          httpStatus: e.status,
          errorCode: e.code,
          note: terminal ? 'Provider unknown completion: never retry or recover' : undefined,
        });
      } else if (e.kind === 'uncertain') {
        j.settle(entry.key, { state: 'uncertain', httpStatus: e.status, note: e.message });
      } else if (e.kind === 'contract' && j.get(entry.key)?.state === 'in_flight') {
        // A frontend guard refused to send (bad key length / oversized body): never sent, never recoverable.
        j.settle(entry.key, { state: 'rejected', note: `Not sent: ${e.message}` });
      }
      // kind 'contract' from parseOrThrow: already settled as committed above.
    } else {
      // Aborted or unexpected: we do not know whether the server saw it.
      j.settle(entry.key, { state: 'uncertain', note: 'Request interrupted before an answer was received' });
    }
    throw e;
  }
}

/**
 * Run one application command: new key, journal-before-send, classify the
 * outcome. NEVER retries. A deliberate repeat by the user is a new command
 * with a new key.
 */
export async function runCommand<T>(
  spec: CommandSpec<T>,
  opts: { journal?: CommandJournal; signal?: AbortSignal } = {},
): Promise<CommandResult<T>> {
  const j = opts.journal ?? defaultJournal;
  const key = newIdempotencyKey(spec.command);
  const body = JSON.stringify(spec.body);
  j.begin({
    key,
    command: spec.command,
    path: spec.path,
    body,
    sessionId: spec.sessionId,
    expectedRevision: spec.expectedRevision,
    assetFingerprint: spec.assetFingerprint,
  });
  const value = await send({ key, path: spec.path, body }, spec.schema, j, opts.signal);
  return { value, key, replayed: false };
}

/**
 * User-initiated recovery of an uncertain command: re-send the IDENTICAL key
 * and body string. If the original committed, the backend returns its original
 * saved response (possibly older than the current state: callers must refetch).
 * Never called automatically. Refused for terminal/provider entries.
 */
export async function recoverCommand<T>(
  key: string,
  schema: ZodType<T>,
  opts: { journal?: CommandJournal; signal?: AbortSignal } = {},
): Promise<CommandResult<T>> {
  const j = opts.journal ?? defaultJournal;
  const entry = j.get(key);
  if (!entry) throw new Error('No journal entry for this key');
  if (entry.state === 'terminal') {
    throw new Error('This command ended in provider unknown completion and must never be retried or recovered.');
  }
  if (entry.state !== 'uncertain') {
    throw new Error(`Only uncertain commands can be recovered (this one is ${entry.state}).`);
  }
  const value = await send(entry, schema, j, opts.signal);
  return { value, key, replayed: true };
}

/** Mark an uncertain entry as given up (e.g. the session no longer exists in this database). */
export function abandonCommand(key: string, note: string, j: CommandJournal = defaultJournal): void {
  const e = j.get(key);
  if (e && e.state === 'uncertain') j.settle(key, { state: 'abandoned', note });
}
