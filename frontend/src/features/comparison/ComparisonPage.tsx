import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/errors';
import { useBackendStatus, useComparison, useSession } from '@/state/hooks';
import { localIndex } from '@/state/localIndex';
import { shortId } from '@/domain/format';
import { ALLOCATOR_LABEL, PREDICTOR_LABEL, policyLabel } from '@/domain/ontology';
import { EvidenceLabel, ProvenanceChips } from '@/components/evidence/EvidenceLabel';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';
import { RawJson } from '@/components/ui/RawJson';
import { BranchTree } from '@/components/comparison/BranchTree';
import { CostLedger } from '@/components/comparison/CostLedger';
import { EstimatesPanel } from '@/components/comparison/EstimatesPanel';
import { ExpansionStepper } from '@/components/comparison/ExpansionStepper';
import { NodeDetail } from '@/components/comparison/NodeDetail';

export function ComparisonPage() {
  const { jobId } = useParams();
  const q = useComparison(jobId);
  const job = q.data;
  const sessionQ = useSession(job?.session_id);
  const status = useBackendStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepOverride, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!job) return;
    if (!localIndex.list().some((e) => e.kind === 'job' && e.id === job.id)) {
      localIndex.upsert({
        kind: 'job',
        id: job.id,
        sessionId: job.session_id,
        factualRevision: job.factual_revision,
        label: `${ALLOCATOR_LABEL[allocatorKey(job.result.allocator_id)]?.label ?? job.result.allocator_id} · budget ${job.result.budget} · ${job.policies
          .map((p) => policyLabel(p[0]))
          .join(' vs ')}`,
        createdAt: new Date().toISOString(),
      });
    }
  }, [job]);

  if (q.isPending) return <p className="text-muted">Loading comparison…</p>;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.code === 'NOT_FOUND';
    return (
      <div className="max-w-2xl space-y-3">
        <ErrorPanel error={q.error} title={notFound ? 'Comparison not found in this backend database' : undefined} />
        <Link to="/lab" className="btn no-underline">
          Back to Live Session
        </Link>
      </div>
    );
  }
  if (!job) return null;

  const { result } = job;
  const total = result.expansion_order.length;
  const step = stepOverride ?? total;
  const selectedNode = selectedId ? result.nodes.find((n) => n.node_id === selectedId) : undefined;
  const session = sessionQ.data;
  const caps = status.kind === 'offline' || status.kind === 'live' ? status.capabilities : undefined;
  const fingerprintMismatch = caps && caps.asset_manifest_fingerprint !== job.asset_manifest_fingerprint;
  const engine = result.nodes[0]?.engine;
  const human = session?.world_kind === 'human_interaction';
  const oracleBest = job.oracle && typeof job.oracle.best_policy === 'string' ? job.oracle.best_policy : null;
  const regret = job.metrics && 'regret' in job.metrics ? job.metrics.regret : undefined;
  const unavailable = human ? 'Not available for human sessions' : session ? 'Not requested for this comparison' : 'Not available';
  const allocatorName = ALLOCATOR_LABEL[allocatorKey(result.allocator_id)]?.label ?? result.allocator_id;

  return (
    <div className="space-y-5">
      <header className="surface-hypothetical p-5">
        <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-3 flex flex-wrap items-center gap-3 rounded bg-white/90 px-3 py-2 backdrop-blur">
          <EvidenceLabel tone="hypothetical">Hypothetical · counterfactual</EvidenceLabel>
          <p className="text-sm font-medium">Modeled paths: nothing here happened. The factual session is not changed by a comparison.</p>
        </div>
        <h1 className="text-3xl">Branch comparison</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Two policies are compared over modeled reaction paths from the pending recommendation. An allocator chooses which branches to evaluate within a small
          budget; the limited evaluation then selects one policy.
        </p>

        <section aria-label="Comparison summary" className="mt-4 rounded-lg border border-rule bg-white p-4">
          <h2 className="text-lg">At a glance</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Compared policies</dt>
              <dd className="font-medium">{job.policies.map((p) => policyLabel(p[0])).join(' vs ')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Allocator · branch budget</dt>
              <dd className="font-medium">
                {allocatorName} · {result.budget}{' '}
                <span className="text-xs font-normal text-muted">({result.actual_expansions} expansions)</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Selected by the limited evaluation</dt>
              <dd className="font-semibold">{policyLabel(result.selected_policy)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Synthetic oracle prefers</dt>
              <dd className={oracleBest ? 'font-semibold' : 'text-muted'}>{oracleBest ? policyLabel(oracleBest) : unavailable}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Selection regret</dt>
              <dd className={regret !== undefined ? 'mono font-semibold' : 'text-muted'} title={regret !== undefined ? String(regret) : undefined}>
                {regret !== undefined ? (typeof regret === 'number' ? String(Number(regret.toPrecision(4))) : String(regret)) : unavailable}
              </dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted">Factual session</dt>
              <dd>
                {session ? (
                  session.revision === job.factual_revision ? (
                    <span>
                      <strong>Unchanged</strong> by this comparison (still at revision <span className="mono">{session.revision}</span>)
                    </span>
                  ) : (
                    <span>
                      Has since advanced to revision <span className="mono">{session.revision}</span> through its own turns; this comparison stays a record of
                      revision <span className="mono">{job.factual_revision}</span>
                    </span>
                  )
                ) : (
                  <span className="text-muted">{sessionQ.isPending ? 'checking…' : 'not available'}</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            All values are returned by the backend. The budget limits how many hypothetical branches are evaluated; it does not cover the cost of preparing the
            branch forest. One comparison is evidence about this root and simulator only, not a claim that any allocator is better in general.
          </p>
        </section>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-muted">Root, revision and session identifiers</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Factual root</dt>
            <dd className="mono text-xs">{job.root_id}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Pinned at session revision</dt>
            <dd className="mono">{job.factual_revision}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Session now</dt>
            <dd>
              {session ? (
                <>
                  <span className="mono">revision {session.revision}</span>
                  <span className="block text-xs text-muted">
                    {session.revision === job.factual_revision
                      ? 'unchanged since this comparison: the root is still pending'
                      : 'has since advanced; this comparison remains a record of its hypothetical root'}
                  </span>
                </>
              ) : (
                <span className="text-muted">{sessionQ.isPending ? 'checking…' : 'not available'}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Session</dt>
            <dd>
              <Link to={`/lab/sessions/${job.session_id}`} className="mono text-xs text-teal underline">
                {shortId(job.session_id, 13)}
              </Link>
            </dd>
          </div>
        </dl>
        </details>
      </header>

      {session && (
        <p className="text-sm text-muted">
          Branch probabilities use the frozen population model, whatever this session’s own forecast model (
          {PREDICTOR_LABEL[session.predictor]?.label ?? session.predictor}); its adaptation is not carried down the hypothetical branches.
        </p>
      )}

      {fingerprintMismatch && (
        <Notice tone="warn" alert title="Asset fingerprint differs from this backend">
          This comparison was produced under asset fingerprint <span className="mono">{shortId(job.asset_manifest_fingerprint, 12)}</span>, which does not match
          the connected backend’s. It is shown as a record only.
        </Notice>
      )}

      <section className="surface-hypothetical p-4" aria-labelledby="tree">
        <h2 id="tree" className="mb-3 text-xl">
          Two-depth reaction tree
        </h2>
        <BranchTree result={result} step={step} selectedId={selectedId} onSelect={setSelectedId} />
        <p className="mt-3 text-xs text-muted">
          The complete tree has 20 paired reaction nodes (4 first reactions + 16 second reactions). Faint slots were not expanded within the budget and carry no
          estimate. Probabilities shown are the backend’s display values (the mean across both compared policies).
        </p>
      </section>

      <ExpansionStepper result={result} step={step} onStep={setStep} onSelect={(id) => setSelectedId(id)} />

      {selectedNode ? (
        <NodeDetail node={selectedNode} order={result.expansion_order.indexOf(selectedNode.node_id)} />
      ) : (
        <p className="rounded border border-dashed border-rule-strong p-3 text-sm text-muted">Select a node in the tree to see each policy’s probabilities, downstream recipe and utility there.</p>
      )}

      <section className="surface-hypothetical p-4" aria-labelledby="sel">
        <h2 id="sel" className="text-xl">
          Selected policy’s prepared root action
        </h2>
        <p className="mt-1 text-sm">
          <strong>{policyLabel(result.selected_policy)}</strong> would recommend <strong>{result.selected_action.selected_item.title}</strong> at this root.
        </p>
        <p className="mt-1 text-xs text-muted">
          A hypothetical action for comparison. It is not committed to the session, and the session’s configured policy is unchanged.
        </p>
      </section>

      <EstimatesPanel comparison={job} human={human} />

      <details className="surface p-4">
        <summary className="cursor-pointer select-none text-lg font-semibold">Cost ledger, provider accounting and job provenance</summary>
        <div className="mt-3 space-y-4">
      <CostLedger costs={job.costs} result={result} />

      <section className="surface p-4" aria-label="Job provenance">
        <h3 className="text-lg">Job provenance</h3>
        <div className="mt-2">
          <ProvenanceChips provenance={job.provenance} />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Allocator</dt>
            <dd className="mono break-all text-xs">
              {result.allocator_id} · {result.allocator_version}
            </dd>
          </div>
          {engine && (
            <div>
              <dt className="text-xs text-muted">Branch engine</dt>
              <dd className="mono break-all text-xs">
                {engine.identifier} · {engine.version}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted">Comparison id</dt>
            <dd className="mono break-all text-xs">{job.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Asset fingerprint</dt>
            <dd className="mono break-all text-xs">{job.asset_manifest_fingerprint}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">
          Job provenance is built by the backend for this comparison and is displayed verbatim. A comparison job is an immutable record: it is never recomputed
          and never updated by later session activity.
        </p>
      </section>
        </div>
      </details>

      <RawJson data={job} label="Raw comparison JSON (as returned)" />
    </div>
  );
}

function allocatorKey(id: string): string {
  if (id.startsWith('equal')) return 'equal';
  if (id.startsWith('greedy')) return 'greedy';
  if (id.startsWith('uncertainty')) return 'uncertainty';
  if (id.startsWith('pcub')) return 'pcub';
  return id;
}
