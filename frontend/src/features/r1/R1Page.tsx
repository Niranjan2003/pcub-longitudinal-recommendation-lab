import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useReferenceResultsR1 } from '@/state/hooks';
import { formatCount, formatPercent, formatValue, shortHash } from '@/domain/format';
import { policyLabel, ALLOCATOR_LABEL } from '@/domain/ontology';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { RawJson } from '@/components/ui/RawJson';

/** Safe path access into loosely-typed frozen tables. Missing paths are reported, never invented. */
function at(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const keys = (v: unknown): string[] => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object) : []);
const MISSING = <span className="text-muted">not present in this response</span>;
const num = (v: unknown, digits = 4): ReactNode => (isNum(v) ? <span className="mono tabular" title={String(v)}>{formatValue(v, digits)}</span> : MISSING);
const pct = (v: unknown): ReactNode => (isNum(v) ? <span className="mono tabular" title={String(v)}>{formatPercent(v, 2)}</span> : MISSING);

function Section({ id, rq, title, children, stamp }: { id: string; rq: string; title: string; children: ReactNode; stamp: string }) {
  return (
    <section aria-labelledby={id} className="surface-archive p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono text-xs uppercase tracking-widest text-[#6b5a2d]">{rq}</p>
          <h2 id={id} className="text-2xl">
            {title}
          </h2>
        </div>
        <EvidenceLabel tone="archive">{stamp}</EvidenceLabel>
      </div>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

const Sans = ({ children }: { children: ReactNode }) => <div className="font-sans">{children}</div>;

export function R1Page() {
  const q = useReferenceResultsR1();

  if (q.isPending) return <p className="text-muted">Loading the frozen R1 results…</p>;
  if (q.error) return <ErrorPanel error={q.error} />;
  const r = q.data;
  const t = r.tables;
  const backends = keys(at(t, 'primary_comparison'));

  return (
    <div className="space-y-6">
      {/* Archive stamp */}
      <header className="surface-archive p-6">
        <div className="flex flex-wrap items-center gap-3">
          <EvidenceLabel tone="archive">Frozen historical R1</EvidenceLabel>
          <EvidenceLabel tone={r.formal_closure_present ? 'warn' : 'neutral'}>formal closure present: {String(r.formal_closure_present)}</EvidenceLabel>
        </div>
        <h1 className="mt-3 text-3xl">Historical R1 results</h1>
        <p className="mt-2 max-w-3xl text-lg">{r.claim}</p>
        <Sans>
          <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">world_kind</dt>
              <dd className="mono">{r.world_kind}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reference run fingerprint</dt>
              <dd className="mono" title={r.reference_run_fingerprint}>
                {shortHash(r.reference_run_fingerprint, 16)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 max-w-3xl border-l-4 border-warn pl-3 text-sm">
            These are <strong>captured aggregates from the frozen historical R1 experiment</strong>, not results of anything you do in this application. They are
            never updated by sessions or comparisons, and nothing on this page mixes with interactive evidence. The R1 program is <strong>not formally
            closed</strong>. Values below are read from the backend’s response; the frontend computes none of them.{' '}
            <Link to="/lab" className="text-teal underline">
              Live Session
            </Link>
          </p>
        </Sans>
      </header>

      {/* RQ1 */}
      <Section id="rq1" rq="R1 · RQ1" title="Does guarded-LLM scoring improve expected value over feedback-sequence?" stamp="Frozen · historical">
        <Sans>
          <p className="text-sm">
            Documented outcome: <strong>a positive guarded gain was not established</strong> (see the claim above). Gain here is guarded minus feedback-sequence
            expected depth-two synthetic-oracle value, aggregated over profiles with a cluster bootstrap.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {backends.map((b) => {
              const g = at(t, 'primary_comparison', b, 'primary_expected_oracle_policy_value');
              const means = at(t, 'primary_comparison', b, 'mean_expected_policy_values');
              return (
                <div key={b} className="rounded border border-[#cdbf9f] bg-white/70 p-4">
                  <h3 className="mono text-sm font-semibold">{b}</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="col-span-2">
                      <dt className="text-xs text-muted">Gain estimate (guarded − feedback)</dt>
                      <dd>{num(at(g, 'estimate'), 6)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{isNum(at(g, 'confidence_level')) ? `${(at(g, 'confidence_level') as number) * 100}% interval` : 'Interval'} lower</dt>
                      <dd>{num(at(g, 'lower'), 6)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">upper</dt>
                      <dd>{num(at(g, 'upper'), 6)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Profile wins / losses / ties</dt>
                      <dd className="mono">
                        {formatCount(at(g, 'wins') as number)} / {formatCount(at(g, 'losses') as number)} / {formatCount(at(g, 'ties') as number)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Profiles</dt>
                      <dd className="mono">{formatCount(at(g, 'profile_count') as number)}</dd>
                    </div>
                  </dl>
                  <table className="mt-3 w-full text-left text-sm">
                    <caption className="mb-1 text-left text-xs text-muted">Mean expected policy value (oracle)</caption>
                    <tbody>
                      {keys(means).map((p) => (
                        <tr key={p} className="border-t border-[#e0d6bd]">
                          <th scope="row" className="py-1 pr-2 font-normal">
                            {policyLabel(p)}
                          </th>
                          <td className="text-right">{num(at(means, p), 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">Method and seed are in the verbatim table below. This is a simulator-relative result, not a measure of human benefit.</p>
        </Sans>
      </Section>

      {/* RQ2 */}
      <Section id="rq2" rq="R1 · RQ2" title="Do policies respond to history (sibling top-1 sensitivity)?" stamp="Frozen · historical">
        <Sans>
          <p className="text-sm">
            Share of sibling comparisons whose top-ranked recipe changed when only the prior history differed. <strong>Sensitivity is not utility</strong>: a policy
            can react strongly to history without producing better outcomes (see RQ1).
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">Sibling top-1 divergence rate by policy and backend</caption>
              <thead>
                <tr className="border-b border-[#cdbf9f] text-xs text-muted">
                  <th className="py-1 pr-3 font-medium">Policy</th>
                  {keys(at(t, 'branch_metrics')).map((b) => (
                    <th key={b} className="mono py-1 pr-3 font-medium">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys(at(t, 'branch_metrics', keys(at(t, 'branch_metrics'))[0] ?? '', 'policy_sensitivity')).map((p) => (
                  <tr key={p} className="border-b border-[#e0d6bd]">
                    <th scope="row" className="py-1.5 pr-3 font-normal">
                      {policyLabel(p)}
                    </th>
                    {keys(at(t, 'branch_metrics')).map((b) => (
                      <td key={b} className="py-1.5 pr-3">
                        {pct(at(t, 'branch_metrics', b, 'policy_sensitivity', p, 'top1_divergence_rate'))}
                        <span className="block text-xs text-muted">fixed candidate set: {pct(at(t, 'branch_metrics', b, 'policy_sensitivity', p, 'fixed_candidate_set_top1_divergence_rate'))}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sans>
      </Section>

      {/* RQ3 */}
      <Section id="rq3" rq="R1 · RQ3" title="Does PCUB allocation beat the alternatives (mean regret by allocator)?" stamp="Frozen · historical">
        <Sans>
          <p className="text-sm">
            Documented outcome: <strong>strict PCUB superiority was not established</strong> (see the claim above). Mean regret is measured against the synthetic
            oracle across all budget-limited cases; it is read from the response and lower is better, but the table is shown in full without a winner called.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {keys(at(t, 'branch_metrics')).map((b) => (
              <div key={b} className="rounded border border-[#cdbf9f] bg-white/70 p-4">
                <h3 className="mono text-sm font-semibold">{b}</h3>
                <table className="mt-2 w-full text-left text-sm">
                  <caption className="sr-only">Mean regret by allocator</caption>
                  <tbody>
                    {keys(at(t, 'branch_metrics', b, 'mean_regret_by_allocator')).map((a) => {
                      const short = a.startsWith('equal') ? 'equal' : a.startsWith('greedy') ? 'greedy' : a.startsWith('uncertainty') ? 'uncertainty' : a.startsWith('pcub') ? 'pcub' : a;
                      return (
                        <tr key={a} className="border-t border-[#e0d6bd]">
                          <th scope="row" className="py-1 pr-2 font-normal">
                            {ALLOCATOR_LABEL[short]?.label ?? a}
                          </th>
                          <td className="text-right">{num(at(t, 'branch_metrics', b, 'mean_regret_by_allocator', a), 6)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs text-muted">
                  <div>
                    <dt>Cases</dt>
                    <dd className="mono">{formatCount(at(t, 'branch_metrics', b, 'case_count') as number)}</dd>
                  </div>
                  <div>
                    <dt>Nonzero-regret cases</dt>
                    <dd className="mono">{formatCount(at(t, 'branch_metrics', b, 'nonzero_regret_count') as number)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Sans>
      </Section>

      {/* RQ4 */}
      <Section id="rq4" rq="R1 · RQ4" title="Was the experiment operationally reliable and exactly replayable?" stamp="Frozen · historical">
        <Sans>
          <p className="text-sm">
            Documented outcome: favorable operational and exact-replay evidence. <strong>Formal acceptance and project closure were not completed</strong>: this
            page does not claim them.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="rounded border border-[#cdbf9f] bg-white/70 p-4">
              <h3 className="text-sm font-semibold">Provider accounting (R1 experiment only)</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ['Reserved attempts', at(t, 'llm_accounting', 'reserved_attempts')],
                    ['Completed records', at(t, 'llm_accounting', 'completed_records')],
                    ['Unknown requests', at(t, 'llm_accounting', 'unknown_requests')],
                    ['Fallbacks', at(t, 'llm_accounting', 'fallbacks')],
                    ['Total tokens', at(t, 'llm_accounting', 'usage', 'total_tokens')],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mono tabular">{isNum(v) ? v.toLocaleString('en-US') : MISSING}</dd>
                  </div>
                ))}
                <div className="col-span-2">
                  <dt className="text-xs text-muted">Cost (as recorded)</dt>
                  <dd className="text-xs">{String(at(t, 'llm_accounting', 'cost') ?? 'not present')}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">Distinct from this demo backend’s own provider journal, which is a separate record.</p>
            </div>
            <div className="rounded border border-[#cdbf9f] bg-white/70 p-4">
              <h3 className="text-sm font-semibold">Exact replay record</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted">Mode</dt>
                  <dd className="mono">{String(at(t, 'replay_record', 'mode') ?? 'not present')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Network calls</dt>
                  <dd className="mono">{isNum(at(t, 'replay_record', 'network_calls')) ? String(at(t, 'replay_record', 'network_calls')) : MISSING}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">New live reservations</dt>
                  <dd className="mono">{isNum(at(t, 'replay_record', 'new_live_reservations')) ? String(at(t, 'replay_record', 'new_live_reservations')) : MISSING}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Guarded cache replays</dt>
                  <dd className="mono">{isNum(at(t, 'replay_record', 'guarded_cache_replays')) ? (at(t, 'replay_record', 'guarded_cache_replays') as number).toLocaleString('en-US') : MISSING}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Trajectories replayed</dt>
                  <dd className="mono">{Array.isArray(at(t, 'replay_record', 'trajectories')) ? (at(t, 'replay_record', 'trajectories') as unknown[]).length : MISSING}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Branch traces replayed</dt>
                  <dd className="mono">{Array.isArray(at(t, 'replay_record', 'branch_traces')) ? (at(t, 'replay_record', 'branch_traces') as unknown[]).length : MISSING}</dd>
                </div>
              </dl>
            </div>
          </div>
        </Sans>
      </Section>

      {/* Verbatim tables */}
      <section className="surface-archive p-6" aria-labelledby="verb">
        <h2 id="verb" className="text-xl">
          Verbatim tables
        </h2>
        <Sans>
          <p className="mt-1 text-sm text-muted">The full response, table by table, exactly as returned. Loaded only when opened.</p>
          <div className="mt-3 space-y-2">
            {Object.entries(t).map(([name, data]) => (
              <RawJson key={name} data={data} label={name} />
            ))}
          </div>
        </Sans>
      </section>
    </div>
  );
}
