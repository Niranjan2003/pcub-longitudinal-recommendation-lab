import { useCapabilities, useJournal, useLocalIndex } from '@/state/hooks';
import { journal } from '@/api/commands/journal';
import { localIndex } from '@/state/localIndex';
import { RawJson } from '@/components/ui/RawJson';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';
import { JournalPanel } from './JournalPanel';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function SystemPage() {
  const caps = useCapabilities();
  const entries = useJournal();
  const index = useLocalIndex();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl">System</h1>
        <p className="mt-1 max-w-2xl text-muted">Connection diagnostics, the backend’s declared capabilities, and this browser’s local records.</p>
      </header>

      <section aria-labelledby="caps" className="surface p-5">
        <h2 id="caps" className="text-xl">
          Backend capabilities
        </h2>
        {caps.isPending && <p className="mt-2 text-muted">Loading…</p>}
        {caps.error && (
          <div className="mt-3">
            <ErrorPanel error={caps.error} />
          </div>
        )}
        {caps.data && (
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="font-semibold">Mode</dt>
            <dd className="mono">{caps.data.mode}</dd>
            <dt className="font-semibold">API version</dt>
            <dd className="mono">{caps.data.api_version}</dd>
            <dt className="font-semibold">Policies</dt>
            <dd className="mono">{caps.data.policies.join(', ')}</dd>
            <dt className="font-semibold">Backends</dt>
            <dd className="mono">{caps.data.backends.join(', ')}</dd>
            <dt className="font-semibold">Predictors</dt>
            <dd className="mono">{caps.data.predictors.join(', ')}</dd>
            <dt className="font-semibold">Allocators</dt>
            <dd className="mono">{caps.data.allocators.join(', ')}</dd>
            <dt className="font-semibold">Budgets</dt>
            <dd className="mono">{caps.data.budgets.join(', ')}</dd>
            <dt className="font-semibold">Branch depth</dt>
            <dd className="mono">{caps.data.branch_depth ?? 'not reported'}</dd>
            <dt className="font-semibold">Human oracle</dt>
            <dd className="mono">{String(caps.data.human_oracle ?? 'not reported')}</dd>
            <dt className="font-semibold">Live guarded</dt>
            <dd className="mono">{String(caps.data.live_guarded ?? 'not reported')}</dd>
            <dt className="font-semibold">Conformal (backend text)</dt>
            <dd>{caps.data.conformal ?? 'not reported'}</dd>
            <dt className="font-semibold">Recorded guarded (backend text)</dt>
            <dd>{caps.data.recorded_guarded ?? 'not reported'}</dd>
            <dt className="font-semibold">Asset fingerprint</dt>
            <dd className="mono break-all">{caps.data.asset_manifest_fingerprint}</dd>
          </dl>
        )}
        {caps.data && (
          <div className="mt-3">
            <RawJson data={caps.data} />
          </div>
        )}
      </section>

      <section aria-labelledby="journal" className="surface p-5">
        <h2 id="journal" className="text-xl">
          Command journal
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every state-changing request is recorded here <em>before</em> it is sent, with its idempotency key and exact body. If an answer is lost, a command
          can be recovered by replaying the identical request. Nothing is ever replayed automatically.
        </p>
        {!journal.persistent && (
          <div className="mt-3">
            <Notice tone="warn" title="Browser storage unavailable">
              The journal only lives in memory for this page load: recovery after a reload is not possible.
            </Notice>
          </div>
        )}
        <div className="mt-3">
          <JournalPanel />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn" onClick={() => download('pcub-command-journal.json', journal.exportJson())} disabled={entries.length === 0}>
            Export journal
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('Clear the local command journal? Uncertain commands could no longer be recovered.')) journal.clear();
            }}
            disabled={entries.length === 0}
          >
            Clear journal
          </button>
        </div>
      </section>

      <section aria-labelledby="index" className="surface p-5">
        <h2 id="index" className="text-xl">
          Known sessions and comparisons
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The backend cannot list sessions or comparison jobs, so this browser remembers the identifiers it has seen. Only identifiers and labels are stored
          here.
        </p>
        <p className="mt-2 text-sm">
          <strong>{index.filter((e) => e.kind === 'session').length}</strong> sessions · <strong>{index.filter((e) => e.kind === 'job').length}</strong>{' '}
          comparisons
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn" onClick={() => download('pcub-local-index.json', localIndex.exportJson())} disabled={index.length === 0}>
            Export index
          </button>
        </div>
      </section>
    </div>
  );
}
