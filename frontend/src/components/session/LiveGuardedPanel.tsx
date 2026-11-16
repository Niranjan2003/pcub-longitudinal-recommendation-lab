import { useId, useState } from 'react';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { Notice } from '@/components/ui/Notice';

/**
 * Shown for a guarded-LLM session while the backend is live-capable. It says
 * exactly what a live request is and does, and holds the deliberate, per-session
 * consent that must exist before the first command that can reach the provider.
 */
export function LiveGuardedPanel({
  consent,
  halted,
  earlierUnknown,
  busy,
  onGrant,
  onRevoke,
}: {
  consent: boolean;
  halted: boolean;
  earlierUnknown: boolean;
  busy: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const boxId = useId();
  return (
    <section className="rounded-lg border-2 border-danger bg-danger-soft p-4" aria-label="Live guarded LLM scoring">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Live guarded LLM scoring</h3>
        <EvidenceLabel tone="danger">LIVE provider</EvidenceLabel>
      </div>
      {consent && !halted ? (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer select-none">How live guarded scoring works and what it cannot do</summary>
          <LiveExplanation />
        </details>
      ) : (
        <LiveExplanation />
      )}

      {earlierUnknown && !halted && (
        <div className="mt-3">
          <Notice tone="warn" title="An earlier provider request ended in unknown completion">
            The command journal in this browser has a provider request whose outcome is unknown. Keep the backend’s provider journal as evidence. The backend
            never sends that decision again.
          </Notice>
        </div>
      )}

      {halted ? (
        <div className="mt-3">
          <Notice tone="danger" alert title="Live provider requests are stopped on this page">
            A provider request ended in unknown completion. It must not be retried. Stop live operations and preserve the provider journal. Reloading the page
            does not change the backend’s journal.
          </Notice>
        </div>
      ) : consent ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-danger" role="status">
            Live provider requests are allowed for this session in this browser tab. Each one still needs its own click.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={onRevoke}>
            Withdraw permission
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor={boxId} className="flex items-start gap-2 text-sm">
            <input id={boxId} type="checkbox" className="mt-1 accent-teal" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>
              I understand that guarded recommendations in this session may send the session’s observable context and safe shortlist to the configured
              provider, and that each request counts against the backend’s live-call limit.
            </span>
          </label>
          <button type="button" className="btn btn-primary" disabled={!understood || busy} onClick={onGrant}>
            Allow live provider requests for this session
          </button>
          <p className="text-xs text-muted">Until you allow them, no command that could reach the provider is sent. Reloading the page asks again.</p>
        </div>
      )}
    </section>
  );
}

/** The full explanation; shown in full before permission, collapsible afterwards. */
function LiveExplanation() {
  return (
    <>
      <p className="mt-1 text-sm">
        The backend is <strong>live-capable</strong>. For this session’s guarded-LLM policy, each <em>Get recommendation</em> can send{' '}
        <strong>one request</strong> to the provider the operator configured on the backend.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          <strong>It only scores the safe shortlist.</strong> The backend first removes every recipe that breaks the declared hard constraints and keeps a
          shortlist of at most 10. The model returns one score from 0 to 100 per shortlisted position; the backend sorts the scores into the ranking.
        </li>
        <li>
          It cannot add recipes, relax constraints, write reactions or change the session state. Reactions come from you or the simulator, and the forecast
          comes from the predictor.
        </li>
        <li>
          A decision context that was already answered (one of the recorded decisions, or an earlier live answer in the provider journal) is reused, and no
          request is sent. The panel under each recommendation shows which case happened.
        </li>
        <li>
          An answer that is not a valid score vector is recorded as such, and the backend uses its precomputed fallback: the feedback-sequence policy’s ranking
          of the same safe candidates.
        </li>
        <li>
          Nothing is retried automatically. If a request’s outcome is unknown, the backend refuses that decision for good, and this page stops all live
          requests.
        </li>
        <li>The provider endpoint and token stay in the backend process. This browser never receives or stores them.</li>
      </ul>
      <p className="mt-2 text-sm">
        Multi-turn runs are off for live guarded sessions, so each provider request follows a separate click. Branch comparisons with the guarded LLM are
        disabled in live mode.
      </p>
    </>
  );
}
