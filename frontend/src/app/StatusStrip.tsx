import { useBackendStatus } from '@/state/hooks';
import type { BackendStatus } from '@/state/backendStatus';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';

function Dot({ tone }: { tone: 'ok' | 'warn' | 'danger' | 'idle' }) {
  const color = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', idle: 'bg-muted' }[tone];
  return <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function describe(s: BackendStatus): { tone: 'ok' | 'warn' | 'danger' | 'idle'; text: string } {
  switch (s.kind) {
    case 'loading':
      return { tone: 'idle', text: 'Connecting to backend…' };
    case 'live':
      return { tone: 'ok', text: 'Live backend connected' };
    case 'offline':
      return { tone: 'ok', text: 'Backend connected' };
    case 'unreachable':
      return { tone: 'danger', text: 'Backend not reachable' };
    case 'unauthorized':
      return { tone: 'danger', text: 'Backend requires a token (401)' };
    case 'origin_denied':
      return { tone: 'danger', text: 'Origin denied (403)' };
    case 'asset_failure':
      return { tone: 'danger', text: 'Backend asset integrity failure' };
    case 'contract_mismatch':
      return { tone: 'danger', text: 'Capabilities contract mismatch' };
    case 'error':
      return { tone: 'danger', text: `Backend error ${s.error.code ?? ''}` };
  }
}

/**
 * Small connection indicator in the header: a dot and one short label. It shows
 * no API version, asset fingerprint or guarded-LLM capability text; the guarded
 * LLM and its per-session permission are introduced on the Live Session page
 * (LiveGuardedPanel), and the System page lists the backend's capabilities.
 */
export function ConnectionIndicator() {
  const d = describe(useBackendStatus());
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite" aria-label="Backend status">
      <Dot tone={d.tone} />
      {d.text}
    </span>
  );
}

/** Error banners that must stay visible whenever they apply. Live capability is never shown as an alarm. */
export function GlobalBanners() {
  const status = useBackendStatus();
  return (
    <div>
      {status.kind === 'unreachable' && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4">
          <Notice tone="danger" alert title="Backend temporarily unavailable">
            Please try again shortly.
          </Notice>
        </div>
      )}
      {(status.kind === 'unauthorized' || status.kind === 'origin_denied' || status.kind === 'asset_failure') && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4">
          <Notice
            tone="danger"
            alert
            title={status.kind === 'unauthorized' ? 'Backend requires an operator token' : status.kind === 'origin_denied' ? 'Origin denied' : 'Asset integrity failure'}
          >
            {status.kind === 'unauthorized' && 'This frontend never handles tokens. Run an offline backend without DEMO_API_TOKEN.'}
            {status.kind === 'origin_denied' && (
              <>
                Start the backend with <code>DEMO_FRONTEND_ORIGIN=http://localhost:5173</code> and open this app at <code>http://localhost:5173</code>.
              </>
            )}
            {status.kind === 'asset_failure' && 'The backend reports corrupted assets and refuses to serve. This is a backend problem.'}
          </Notice>
        </div>
      )}
      {(status.kind === 'contract_mismatch' || status.kind === 'error') && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4">
          <ErrorPanel error={status.error} />
        </div>
      )}
    </div>
  );
}
