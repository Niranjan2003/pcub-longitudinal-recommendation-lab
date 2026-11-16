import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import { abandonCommand, recoverCommand } from '@/api/commands/runCommand';
import type { JournalEntry } from '@/api/commands/journal';
import { comparisonSchema, sessionSchema } from '@/api/schemas';
import { useBackendStatus, useJournal, useSessionCacheWriter } from '@/state/hooks';
import { queryKeys } from '@/state/queryClient';
import { localIndex } from '@/state/localIndex';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';
import { shortId } from '@/domain/format';

const STATE_TEXT: Record<JournalEntry['state'], string> = {
  in_flight: 'In flight',
  committed: 'Committed',
  rejected: 'Rejected by backend (nothing committed)',
  uncertain: 'Uncertain — may have committed',
  terminal: 'Provider unknown completion — never retry',
  abandoned: 'Abandoned',
};

/**
 * Lists journaled commands. For uncertain commands the USER may recover:
 * the identical request (same key, same body string) is replayed. If the
 * original committed, the backend returns its original response, which is then
 * shown with a fresh GET, never as the current state.
 */
export function JournalPanel({ sessionId, compact = false }: { sessionId?: string; compact?: boolean }) {
  const all = useJournal();
  const live = useBackendStatus().kind === 'live';
  const qc = useQueryClient();
  const writeSession = useSessionCacheWriter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const entries = [...all].filter((e) => (sessionId ? e.sessionId === sessionId : true)).reverse();
  const shown = compact ? entries.filter((e) => e.state === 'uncertain' || e.state === 'terminal' || e.state === 'in_flight').slice(0, 5) : entries.slice(0, 40);

  async function recover(e: JournalEntry) {
    setBusy(e.key);
    setError(null);
    setMessage(null);
    try {
      // Session-scoped commands: confirm the session still exists in this database first.
      if (e.sessionId) {
        try {
          await getSession(e.sessionId);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'NOT_FOUND') {
            abandonCommand(e.key, 'Session not found: the backend database may have changed');
            localIndex.markMissing('session', e.sessionId, true);
            setMessage('That session no longer exists in this backend database, so the command was abandoned rather than replayed.');
            return;
          }
          throw err;
        }
      }
      if (e.command === 'compare') {
        const r = await recoverCommand(e.key, comparisonSchema);
        setMessage(`Recovered comparison ${shortId(r.value.id)} (original committed response).`);
        void qc.invalidateQueries({ queryKey: queryKeys.comparison(r.value.id) });
      } else {
        const r = await recoverCommand(e.key, sessionSchema);
        // The replayed response may be older than the current state: write only if not older, then refetch.
        writeSession(r.value);
        setMessage(`Recovered ${e.command.replace('_', ' ')} (original committed response at revision ${r.value.revision}); session refreshed from the server.`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (shown.length === 0) {
    return compact ? null : <p className="text-sm text-muted">No commands recorded in this browser yet.</p>;
  }

  return (
    <div className="space-y-3">
      {message && <Notice tone="ok">{message}</Notice>}
      {error !== null && <ErrorPanel error={error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Command journal</caption>
          <thead>
            <tr className="border-b border-rule text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Command</th>
              <th className="py-1.5 pr-3">State</th>
              <th className="py-1.5 pr-3">Rev</th>
              <th className="py-1.5 pr-3">Time (local)</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.key} className="border-b border-rule/60 align-top">
                <td className="py-1.5 pr-3">
                  <span className="font-medium">{e.command.replace('_', ' ')}</span>
                  {e.sessionId && <span className="mono ml-2 text-xs text-muted">{shortId(e.sessionId)}</span>}
                  <div className="mono text-xs text-muted" title={e.key}>
                    {shortId(e.key, 28)}
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  <span className={e.state === 'uncertain' || e.state === 'terminal' ? 'font-semibold text-danger' : ''}>{STATE_TEXT[e.state]}</span>
                  {e.errorCode && <code className="ml-2 text-xs">{e.errorCode}</code>}
                  {e.note && <div className="text-xs text-muted">{e.note}</div>}
                </td>
                <td className="mono py-1.5 pr-3">{e.expectedRevision ?? '—'}</td>
                <td className="mono py-1.5 pr-3 text-xs">{new Date(e.createdAt).toLocaleTimeString()}</td>
                <td className="py-1.5 text-right">
                  {e.state === 'uncertain' && (
                    <span className="inline-flex gap-1.5">
                      <button type="button" className="btn btn-primary !min-h-8 !px-3 !py-1 text-xs" disabled={busy !== null} onClick={() => void recover(e)}>
                        {busy === e.key ? 'Recovering…' : 'Recover'}
                      </button>
                      <button
                        type="button"
                        className="btn !min-h-8 !px-3 !py-1 text-xs"
                        disabled={busy !== null}
                        onClick={() => abandonCommand(e.key, 'Abandoned by user')}
                      >
                        Abandon
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.some((e) => e.state === 'uncertain') && (
        <p className="text-xs text-muted">
          Recover replays the identical request with the same idempotency key. If the original request committed, the backend returns the original response;
          otherwise it is executed once.
          {live &&
            ' Live mode: executing a guarded recommendation once can send one provider request, but only if the backend never reserved that decision; a reserved decision is never sent twice.'}
        </p>
      )}
    </div>
  );
}
