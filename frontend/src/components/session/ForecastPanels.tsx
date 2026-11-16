import type { EvidenceRecord, HistoryEntry, Pending, ProviderCosts, Session } from '@/api/schemas';
import { PREDICTOR_LABEL, REACTION_ORDER } from '@/domain/ontology';
import { formatCount, formatValue, shortHash } from '@/domain/format';
import { EvidenceLabel, ProvenanceChips } from '@/components/evidence/EvidenceLabel';
import { ProbabilityBars } from '@/components/viz/ProbabilityBars';
import { ReactionMark, ReactionTag } from '@/components/viz/ReactionMark';
import { REACTION_META } from '@/domain/ontology';

/** Pending forecast: dashed, hatched, explicitly NOT an outcome. */
export function ForecastPanel({ pending, predictor }: { pending: Pending; predictor: string }) {
  const p = PREDICTOR_LABEL[predictor];
  return (
    <section className="surface-pending p-4" aria-label="Forecast (pending)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Forecast</h3>
        <EvidenceLabel tone="pending">Forecast · pending</EvidenceLabel>
      </div>
      <p className="mt-1 text-sm text-muted">
        Saved <strong>before</strong> the reaction, from observable information only. Model: {p?.label ?? predictor}. A forecast, not an outcome.
      </p>
      <div className="mt-3">
        <ProbabilityBars probabilities={pending.probabilities} variant="forecast" caption="Probability of each reaction" />
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">How far to trust this forecast</summary>
        <p className="mt-1">
          The forecast models are frozen and were fitted on synthetic reference data; they are not validated on human reactions. In an audit of 48 structured
          reference turns, Modify / clarify was the most probable class in 42, and adaptation over 12 turns was weak. Disagreement with the realized reaction is
          expected and is not an error.
        </p>
      </details>
    </section>
  );
}

/** Frozen synthetic-reference diagnostics. Backend meaning text shown verbatim. */
export function ConformalPanel({ pending }: { pending: Pending }) {
  const c = pending.conformal_reference;
  const methods = Object.entries(c.sets);
  return (
    <section className="rounded-lg border border-rule-strong bg-paper-2 p-4" aria-label="Conformal diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Conformal reference sets</h3>
        <EvidenceLabel tone="neutral">Diagnostic only</EvidenceLabel>
      </div>
      <p className="mt-1 text-sm">{c.meaning}</p>
      <p className="mt-1 text-xs text-muted">
        Computed from the <strong>population</strong> probabilities (in the expandable below), not from this session’s own forecast. These sets never prune branches and
        carry no guarantee for human feedback.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-sm font-semibold">Show the prediction sets and the population probabilities</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <caption className="sr-only">Prediction sets by method and nominal coverage</caption>
          <thead>
            <tr className="border-b border-rule text-xs text-muted">
              <th className="py-1 pr-3 font-medium">Method</th>
              {methods[0] &&
                Object.keys(methods[0][1]).map((cov) => (
                  <th key={cov} className="py-1 pr-3 font-medium">
                    nominal {cov}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {methods.map(([m, byCov]) => (
              <tr key={m} className="border-b border-rule/60 align-top">
                <th scope="row" className="mono py-1.5 pr-3 font-medium">
                  {m}
                </th>
                {Object.entries(byCov).map(([cov, labels]) => (
                  <td key={cov} className="py-1.5 pr-3">
                    {labels.length === 0 ? (
                      <span className="text-muted">∅ empty set</span>
                    ) : (
                      <span className="inline-flex flex-wrap gap-1.5">
                        {labels.map((l) => (
                          <ReactionMark key={l} reaction={l} size={14} title={REACTION_META[l].label} />
                        ))}
                        <span className="sr-only">{labels.join(', ')}</span>
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <ProbabilityBars probabilities={c.population_probabilities} variant="plain" compact caption="Population probabilities used for these sets" />
      </div>
      </details>
    </section>
  );
}

type ProviderWork = { title: string; text: string; reuse: string; tone: 'danger' | 'neutral' };

/** Plain-language reading of the backend's own provider accounting. Nothing is computed. */
function providerWork(mode: string, costs: ProviderCosts): ProviderWork {
  if (mode === 'deterministic') {
    return {
      title: 'No provider involved',
      text: 'This policy is computed locally by the backend (execution mode “deterministic”) and never contacts a provider.',
      reuse: 'not applicable',
      tone: 'neutral',
    };
  }
  if (mode === 'recorded_guarded') {
    return {
      title: 'Recorded guarded decision',
      text: 'The guarded LLM scorer answered from one of the recorded decisions shipped with the backend. No provider request was made.',
      reuse: 'yes: recorded decision',
      tone: 'neutral',
    };
  }
  if (mode === 'live_guarded' && costs.live_calls !== null && costs.live_calls > 0) {
    return {
      title: 'New live provider decision',
      text: `The backend sent ${costs.live_calls} provider request${costs.live_calls === 1 ? '' : 's'} for this recommendation and journaled the response before using it.`,
      reuse: 'no: new provider response',
      tone: 'danger',
    };
  }
  if (mode === 'live_guarded' && costs.live_calls === 0) {
    return {
      title: 'Live decision reused from the provider journal',
      text: 'This exact decision context was answered by the provider earlier. The journaled decision was reused, and no new request was sent.',
      reuse: 'yes: journaled live decision',
      tone: 'neutral',
    };
  }
  return { title: 'Provider work not determined', text: 'The response does not say how many provider requests were made.', reuse: 'unknown', tone: 'neutral' };
}

/**
 * Provider accounting for THIS recommendation, as returned by the backend.
 * Null means unknown, never zero. In live mode the backend also returns
 * whole-journal snapshots; the record for this decision is looked up by its
 * fingerprint and shown verbatim.
 */
export function ProviderCostMini({ pending }: { pending: Pending }) {
  const costs = pending.provider_costs;
  const mode = pending.provenance.recommendation_execution_mode;
  const work = providerWork(mode, costs);
  const after = costs.journal_after;
  const record = after?.records.find((r) => r.key === pending.source_decision_fingerprint);
  return (
    <section className="rounded border border-rule p-3 text-sm" aria-label="Provider work for this recommendation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Provider work for this recommendation</h4>
        <EvidenceLabel tone={work.tone} title={`recommendation_execution_mode: ${mode}`}>
          {work.title}
        </EvidenceLabel>
      </div>
      <p className="mt-1 text-xs text-muted">{work.text}</p>
      {mode === 'deterministic' ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer select-none text-muted">Accounting fields (all zero for this policy)</summary>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Execution mode</dt>
              <dd className="mono">{mode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reservations</dt>
              <dd className="mono">{formatCount(costs.reservations)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Live calls</dt>
              <dd className="mono">{formatCount(costs.live_calls)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">New tokens</dt>
              <dd className="mono">{formatCount(costs.new_tokens)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Cache reuse</dt>
              <dd className="mono" title={`cache_reuse: ${costs.cache_reuse === null ? 'null' : String(costs.cache_reuse)}`}>
                {work.reuse}
              </dd>
            </div>
            {pending.source_decision_fingerprint && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">Decision fingerprint</dt>
                <dd className="mono break-all text-xs" title={pending.source_decision_fingerprint}>
                  {shortHash(pending.source_decision_fingerprint, 12)}
                </dd>
              </div>
            )}
          </dl>
        </details>
      ) : (
        <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Execution mode</dt>
            <dd className="mono">{mode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Reservations</dt>
            <dd className="mono">{formatCount(costs.reservations)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Live calls</dt>
            <dd className="mono">{formatCount(costs.live_calls)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">New tokens</dt>
            <dd className="mono">{formatCount(costs.new_tokens)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted">Cache reuse</dt>
            <dd className="mono" title={`cache_reuse: ${costs.cache_reuse === null ? 'null' : String(costs.cache_reuse)}`}>
              {work.reuse}
            </dd>
          </div>
          {pending.source_decision_fingerprint && (
            <div className="col-span-2">
              <dt className="text-xs text-muted">Decision fingerprint</dt>
              <dd className="mono break-all text-xs" title={pending.source_decision_fingerprint}>
                {shortHash(pending.source_decision_fingerprint, 12)}
              </dd>
            </div>
          )}
        </dl>
      )}
      {after && (
        <div className="mt-2 border-t border-rule pt-2" aria-label="Provider journal">
          <p className="text-xs font-semibold">Provider journal (whole backend, after this command)</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Reservations</dt>
              <dd className="mono">{after.reservations}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Completed responses</dt>
              <dd className="mono">{after.completed_responses}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Unknown completions</dt>
              <dd className={`mono ${after.unknown > 0 ? 'font-semibold text-danger' : ''}`}>{after.unknown}</dd>
            </div>
            {record?.usage && (
              <div>
                <dt className="text-xs text-muted">This decision’s tokens</dt>
                <dd className="mono" title="input + output = total, as reported by the provider">
                  {formatCount(record.usage.input_tokens)} + {formatCount(record.usage.output_tokens)} = {formatCount(record.usage.total_tokens)}
                </dd>
              </div>
            )}
            {record && record.latency_seconds !== null && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">This decision’s reservation-to-response time</dt>
                <dd className="mono">{formatValue(record.latency_seconds, 2)} s</dd>
              </div>
            )}
          </dl>
          <p className="mt-1 text-xs text-muted">
            Token counts are the provider’s own usage report; no monetary cost is computed. The live-call limit is set by the operator when the backend starts
            and counts every reservation in this journal.
          </p>
        </div>
      )}
    </section>
  );
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Synthetic outcomes carry the simulator's own probabilities and random draws.
 * Shown as a post-hoc audit only: they were never visible to the predictor,
 * the policy or the allocator. Values are verbatim from the backend.
 */
export function SimulatorInternals({ outcome }: { outcome: Record<string, unknown> }) {
  const probs = outcome.outcome_probabilities as Record<string, unknown> | undefined;
  const sample = outcome.sample_provenance as Record<string, unknown> | undefined;
  const ref = outcome.synthetic_reference as { identifier?: string; version?: string } | undefined;
  const codes = Array.isArray(outcome.generation_reason_codes) ? (outcome.generation_reason_codes as unknown[]).map(String) : [];
  if (!probs) return null;
  const vector = REACTION_ORDER.map((r) => (num(probs[r]) ? (probs[r] as number) : 0));
  return (
    <details className="mt-3 rounded border border-rule bg-paper-2 p-3 text-sm">
      <summary className="cursor-pointer select-none font-semibold">Simulator internals (post-hoc audit, not predictor input)</summary>
      <p className="mt-1 text-xs text-muted">
        How the simulator produced this reaction. These private probabilities and draws were never available to the predictor, policy or allocator, and they are
        simulator output, not human behaviour.
      </p>
      <div className="mt-2">
        <ProbabilityBars probabilities={vector} variant="plain" compact caption="Simulator reaction probabilities (private to the generator)" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
        {ref && (
          <div className="col-span-2">
            <dt className="text-xs text-muted">Generator</dt>
            <dd className="mono break-all text-xs">
              {ref.identifier} · {ref.version}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted">Reaction draw</dt>
          <dd className="mono">{num(sample?.reaction_draw) ? String(sample?.reaction_draw) : 'n/a (deterministic)'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Continuation draw</dt>
          <dd className="mono">{num(sample?.continuation_draw) ? String(sample?.continuation_draw) : 'n/a'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Continuation probability</dt>
          <dd className="mono">{num(outcome.continuation_probability) ? String(outcome.continuation_probability) : 'n/a'}</dd>
        </div>
        {codes.length > 0 && (
          <div className="col-span-2">
            <dt className="text-xs text-muted">Reason codes</dt>
            <dd className="mono break-all text-xs">{codes.join(' · ')}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}

/**
 * Forecast made before the reveal, beside what was realized. The two are
 * deliberately different objects with different surfaces.
 */
export function EvidencePair({ record, entry, world }: { record: EvidenceRecord; entry?: HistoryEntry; world: Session['world_kind'] }) {
  const o = record.outcome;
  const surface = world === 'synthetic_simulation' ? 'surface-synthetic' : 'surface-human';
  return (
    <section aria-label="Forecast versus realized reaction" className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="surface-pending p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-base font-semibold">Forecast (made before reveal)</h4>
          <EvidenceLabel tone="pending">Forecast</EvidenceLabel>
        </div>
        <div className="mt-2">
          <ProbabilityBars probabilities={record.forecast.probabilities} variant="forecast" realized={o.reaction} compact />
        </div>
      </div>
      <div className={`${surface} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-base font-semibold">Realized</h4>
          <EvidenceLabel tone={world === 'synthetic_simulation' ? 'synthetic' : 'human'}>
            {world === 'synthetic_simulation' ? 'Synthetic · factual in simulation' : 'Human-submitted · factual'}
          </EvidenceLabel>
        </div>
        <p className="mt-2 text-lg">
          <ReactionTag reaction={o.reaction} size={18} />
        </p>
        <p className="mt-1 text-sm">
          Continuation: <strong>{o.continuation === 'CONTINUE' ? 'Continue' : 'Disengage'}</strong> <span className="text-muted">(a separate flag from the reaction)</span>
        </p>
        {world === 'synthetic_simulation' && o.continuation === 'DISENGAGE' && (
          <p className="mt-1 text-xs text-muted">
            In synthetic sessions a DISENGAGE flag is recorded but does not end the session; only the planned horizon does. (Human DISENGAGE does end it.)
          </p>
        )}
        {o.requested_changes.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {o.requested_changes.map((c, i) => (
              <li key={i}>
                {c.dimensions.length > 0 && <span className="mono text-xs">[{c.dimensions.join(', ')}] </span>}
                {c.instruction ?? c.residual_text}
              </li>
            ))}
          </ul>
        )}
        {entry && <p className="mt-2 text-sm text-muted">Recipe: {entry.action.selected_item.title}</p>}
        <div className="mt-3">
          <ProvenanceChips provenance={record.provenance} />
        </div>
        {world === 'synthetic_simulation' && <SimulatorInternals outcome={o as Record<string, unknown>} />}
      </div>
      <p className="text-xs text-muted lg:col-span-2">
        The forecast is persisted before feedback and is never edited afterwards. Disagreement between the two sides is expected and is not an error; this view
        makes no accuracy claim.
      </p>
    </section>
  );
}
