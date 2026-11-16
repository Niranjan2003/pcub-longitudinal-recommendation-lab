import { ApiError } from './errors';

/**
 * Transport only. No schema knowledge, no retries, no auth headers.
 * The browser always calls relative /v1/... (Vite proxy); tests and the
 * integration suite configure an absolute base.
 */
let baseUrl = '';
export function configureApi(opts: { baseUrl: string }): void {
  baseUrl = opts.baseUrl.replace(/\/$/, '');
}

export const MAX_BODY_BYTES = 65_536;

interface WireErrorBody {
  error?: { code?: unknown; action?: unknown };
}

async function readJson(res: Response): Promise<{ json: unknown; ok: boolean }> {
  const text = await res.text();
  if (!text) return { json: undefined, ok: false };
  try {
    return { json: JSON.parse(text) as unknown, ok: true };
  } catch {
    return { json: text.slice(0, 500), ok: false };
  }
}

function backendError(res: Response, json: unknown): ApiError | null {
  const err = (json as WireErrorBody | undefined)?.error;
  if (err && typeof err === 'object' && typeof err.code === 'string') {
    return new ApiError({
      kind: 'backend',
      message: err.code,
      status: res.status,
      code: err.code,
      action: typeof err.action === 'string' ? err.action : undefined,
      raw: json,
    });
  }
  return null;
}

export async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(baseUrl + path, { method: 'GET', headers: { Accept: 'application/json' }, signal });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError({ kind: 'network', message: 'Could not reach the backend', raw: String(cause) });
  }
  const { json, ok } = await readJson(res);
  const be = ok ? backendError(res, json) : null;
  if (be) throw be;
  if (!res.ok) {
    // Proxy failures (e.g. backend down behind Vite) return non-JSON 5xx.
    throw new ApiError({ kind: 'network', message: `Backend unreachable (HTTP ${res.status})`, status: res.status, raw: json });
  }
  if (!ok) throw new ApiError({ kind: 'contract', message: 'Response was not valid JSON', status: res.status, raw: json });
  return json;
}

export interface PostResult {
  status: number;
  body: unknown;
}

/**
 * POST exactly the supplied body string with the supplied idempotency key.
 * The caller owns key + body persistence (the command journal); this function
 * never generates a key and never retries.
 *
 * A thrown ApiError of kind 'uncertain' means the command may have committed.
 */
export async function postJson(path: string, key: string, body: string, signal?: AbortSignal): Promise<PostResult> {
  if (key.length < 1 || key.length > 128) {
    throw new ApiError({ kind: 'contract', message: 'Idempotency key must be 1–128 characters (frontend bug)' });
  }
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    throw new ApiError({ kind: 'contract', message: `Request body exceeds ${MAX_BODY_BYTES} bytes (frontend guard)` });
  }
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': key },
      body,
      signal,
    });
  } catch (cause) {
    throw new ApiError({ kind: 'uncertain', message: 'No response received; the command may have been committed', raw: String(cause) });
  }
  const { json, ok } = await readJson(res);
  const be = ok ? backendError(res, json) : null;
  if (be) throw be;
  if (res.ok && ok) return { status: res.status, body: json };
  throw new ApiError({
    kind: 'uncertain',
    message: `No usable answer (HTTP ${res.status}); the command may have been committed`,
    status: res.status,
    raw: json,
  });
}
