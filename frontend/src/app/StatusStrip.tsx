import { useBackendStatus, useCapabilities } from '@/state/hooks';
import type { BackendStatus } from '@/state/backendStatus';
import { shortHash } from '@/domain/format';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';

function Dot({ tone }: { tone: 'ok' | 'warn' | 'danger' | 'idle' }) {
  const color = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', idle: 'bg-muted' }[tone];
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

function describe(s: BackendStatus): { tone: 'ok' | 'warn' | 'danger' | 'idle'; text: string } {
  switch (s.kind) {
    case 'loading':
      return { tone: 'idle', text: 'Connecting to backend…' };
    case 'offline':
    case 'live':
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
 * The guarded-LLM capability reported by the connected backend. Neutral styling:
 * a healthy live-capable backend is not an alarm. Live provider requests still
 * need explicit per-session permission (LiveGuardedPanel).
 */
function Capability({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${live ? 'border-teal bg-teal-soft text-teal' : 'border-rule-strong bg-card text-muted'}`}
      title={
        live
          ? 'This backend was started with live guarded scoring. A guarded-LLM session asks for your permission before any provider request; requests are never retried, and the operator’s call limit applies.'
          : 'This backend is offline-only. The guarded LLM answers only the recorded contexts shipped with the backend; no provider request is possible.'
      }
    >
      <span className="sm:hidden">{live ? 'Live LLM available' : 'Offline mode'}</span>
      <span className="hidden sm:inline">
        {live ? 'Live LLM scoring available · per-session permission required' : 'Offline mode · guarded LLM uses recorded decisions only'}
      </span>
    </span>
  );
}

/** Persistent strip: backend reachability, guarded-LLM capability, API version, asset fingerprint. */
export function StatusStrip() {
  const status = useBackendStatus();
  const { refetch, isFetching } = useCapabilities();
  const d = describe(status);
  const caps = status.kind === 'offline' || status.kind === 'live' ? status.capabilities : undefined;

  return (
    <div className="border-b border-rule bg-paper-2" role="status" aria-live="polite" aria-label="Backend status">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <Dot tone={d.tone} />
          {d.text}
        </span>
        {caps && (
          <>
            <Capability live={status.kind === 'live'} />
            <span className="hidden text-xs text-muted md:inline">
              API v<span className="mono">{caps.api_version}</span>
            </span>
            <span className="hidden text-xs text-muted md:inline" title={caps.asset_manifest_fingerprint}>
              assets <span className="mono">{shortHash(caps.asset_manifest_fingerprint, 6)}</span>
            </span>
          </>
        )}
        <button type="button" className="ml-auto text-xs text-teal underline underline-offset-2 disabled:opacity-50" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Checking…' : 'Re-check'}
        </button>
      </div>
    </div>
  );
}

/** Error banners that must stay visible whenever they apply. Live capability is shown in the status strip, not as an alarm. */
export function GlobalBanners() {
  const status = useBackendStatus();
  return (
    <div>
      {status.kind === 'unreachable' && (
        <div className="mx-auto max-w-[1400px] px-4 pt-4">
          <Notice tone="danger" alert title="Backend not reachable">
            {status.detail}. Start the <strong>offline</strong> backend separately (see <code>README_SETUP.md</code>) on <code>127.0.0.1:8765</code>; this
            interface proxies <code>/v1</code> to it and cannot function without it.
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
