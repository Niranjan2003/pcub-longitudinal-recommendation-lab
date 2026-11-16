import { ApiError } from '@/api/errors';
import type { Capabilities } from '@/api/schemas';

export type BackendStatus =
  | { kind: 'loading' }
  | { kind: 'offline'; capabilities: Capabilities }
  | { kind: 'live'; capabilities: Capabilities }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'unauthorized' }
  | { kind: 'origin_denied' }
  | { kind: 'asset_failure' }
  | { kind: 'contract_mismatch'; error: ApiError }
  | { kind: 'error'; error: ApiError };

/**
 * Live-capable means the backend is not strictly offline OR advertises live
 * guarded operation. Either way a guarded-LLM command may cause a real provider
 * request: the UI requires explicit per-session consent before sending one,
 * runs such sessions one turn at a time, and does not send guarded branch
 * comparisons (see SessionPage, useSessionActions and ExplorePage).
 */
export function isLiveCapable(c: Capabilities): boolean {
  return c.mode !== 'offline' || c.live_guarded === true;
}

export function deriveBackendStatus(args: {
  isPending: boolean;
  data: Capabilities | undefined;
  error: unknown;
}): BackendStatus {
  if (args.data) return isLiveCapable(args.data) ? { kind: 'live', capabilities: args.data } : { kind: 'offline', capabilities: args.data };
  if (args.error instanceof ApiError) {
    const e = args.error;
    if (e.kind === 'network') return { kind: 'unreachable', detail: e.message };
    if (e.kind === 'contract') return { kind: 'contract_mismatch', error: e };
    if (e.code === 'UNAUTHORIZED') return { kind: 'unauthorized' };
    if (e.code === 'ORIGIN_DENIED') return { kind: 'origin_denied' };
    if (e.code === 'ASSET_INTEGRITY_FAILURE') return { kind: 'asset_failure' };
    return { kind: 'error', error: e };
  }
  if (args.error) return { kind: 'unreachable', detail: String(args.error) };
  return { kind: 'loading' };
}

/** The only policy that can trigger provider I/O. Gated in the UI whenever the backend is live-capable. */
export const GUARDED_POLICY = 'guarded_llm_score_vector';
