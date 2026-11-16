import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getCapabilities, getComparison, getRecipe, getReferenceResultsR1, getSession } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import { journal } from '@/api/commands/journal';
import type { Session } from '@/api/schemas';
import { deriveBackendStatus } from './backendStatus';
import { localIndex } from './localIndex';
import { stateLog } from './stateLog';
import { IMMUTABLE, queryKeys } from './queryClient';

export function useCapabilities() {
  return useQuery({ queryKey: queryKeys.capabilities, queryFn: ({ signal }) => getCapabilities(signal), staleTime: 30_000 });
}

export function useBackendStatus() {
  const q = useCapabilities();
  return useMemo(() => deriveBackendStatus({ isPending: q.isPending, data: q.data, error: q.error }), [q.isPending, q.data, q.error]);
}

export function useSession(id: string | undefined) {
  const q = useQuery({
    queryKey: queryKeys.session(id ?? ''),
    queryFn: ({ signal }) => getSession(id!, signal),
    enabled: !!id,
    retry: (count, err) => err instanceof ApiError && err.kind === 'network' && count < 2,
  });
  useEffect(() => {
    if (!id) return;
    if (q.data) localIndex.markMissing('session', id, false);
    if (q.error instanceof ApiError && q.error.code === 'NOT_FOUND') localIndex.markMissing('session', id, true);
  }, [id, q.data, q.error]);
  return q;
}

export function useComparison(id: string | undefined) {
  const q = useQuery({
    queryKey: queryKeys.comparison(id ?? ''),
    queryFn: ({ signal }) => getComparison(id!, signal),
    enabled: !!id,
    ...IMMUTABLE,
  });
  useEffect(() => {
    if (!id) return;
    if (q.data) localIndex.markMissing('job', id, false);
    if (q.error instanceof ApiError && q.error.code === 'NOT_FOUND') localIndex.markMissing('job', id, true);
  }, [id, q.data, q.error]);
  return q;
}

export function useRecipe(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recipe(id ?? ''),
    queryFn: ({ signal }) => getRecipe(id!, signal),
    enabled: !!id && enabled,
    ...IMMUTABLE,
  });
}

export function useReferenceResultsR1() {
  return useQuery({ queryKey: queryKeys.r1, queryFn: ({ signal }) => getReferenceResultsR1(signal), ...IMMUTABLE });
}

/**
 * Cache a session returned by a command, but only if its revision is not older
 * than what we already hold (a recovered same-key replay can be older than the
 * current state). Always follow with an invalidation so the server stays the
 * source of truth.
 */
export function writeSessionIfNotOlder(qc: QueryClient, session: Session): boolean {
  const key = queryKeys.session(session.id);
  const current = qc.getQueryData<Session>(key);
  if (current && current.revision > session.revision) return false;
  qc.setQueryData(key, session);
  return true;
}

export function useSessionCacheWriter() {
  const qc = useQueryClient();
  return (session: Session) => {
    const wrote = writeSessionIfNotOlder(qc, session);
    void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) });
    return wrote;
  };
}

export function useJournal() {
  return useSyncExternalStore(journal.subscribe, journal.list, journal.list);
}

export function useLocalIndex() {
  return useSyncExternalStore(localIndex.subscribe, localIndex.list, localIndex.list);
}

export function useStateObservations(sessionId: string) {
  return useSyncExternalStore(stateLog.subscribe, () => stateLog.get(sessionId), () => stateLog.get(sessionId));
}
