import type { Comparison } from '@/api/schemas';
import { formatExact, formatValue } from '@/domain/format';
import { policyLabel } from '@/domain/ontology';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { RawJson } from '@/components/ui/RawJson';

const W = 560;
const ROW = 58;
const PAD = { l: 150, r: 24, t: 14, b: 26 };

/** Numeric record helper for loosely-typed backend objects. */
function numberRecord(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0 || !entries.every(([, x]) => typeof x === 'number')) return null;
  return v as Record<string, number>;
}

/**
 * One row per policy on a shared value axis. Hollow ring = limited estimate
 * (visited-mass renormalized). Double ring = synthetic oracle value, when the
 * backend returned one. The axis range only scales the drawing.
 */
export function ValueDotPlot({
  estimates,
  selected,
  oracle,
  oracleBest,
}: {
  estimates: Record<string, number>;
  selected: string;
  oracle: Record<string, number> | null;
  oracleBest: string | null;
}) {
  const ids = Object.keys(estimates);
  const all = [...Object.values(estimates), ...(oracle ? Object.values(oracle) : [])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const min = lo - span * 0.25;
  const max = hi + span * 0.25;
  const x = (v: number) => PAD.l + ((v - min) / (max - min)) * (W - PAD.l - PAD.r);
  const H = PAD.t + ids.length * ROW + PAD.b;
  const ticks = [min, (min + max) / 2, max];
  // Tick precision adapts to the axis span so neighbouring tick labels never look identical.
  const axisSpan = max - min;
  const tickDigits = axisSpan < 0.0001 ? 7 : axisSpan < 0.001 ? 6 : axisSpan < 0.01 ? 5 : axisSpan < 0.1 ? 4 : 3;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Policy value estimates" className="block w-full max-w-[640px]">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={PAD.t - 4} y2={H - PAD.b} stroke="#d8d3c8" strokeWidth={1} />
            <text x={x(t)} y={H - 8} fontSize={10} textAnchor="middle" fill="#5a626c">
              {t.toFixed(tickDigits)}
            </text>
          </g>
        ))}
        {ids.map((id, i) => {
          const cy = PAD.t + i * ROW + ROW / 2;
          const est = estimates[id]!;
          const orc = oracle?.[id];
          return (
            <g key={id}>
              <text x={PAD.l - 10} y={cy - 3} fontSize={12} textAnchor="end" fill="#1d232b" fontWeight={500}>
                {policyLabel(id)}
              </text>
              <text x={PAD.l - 10} y={cy + 12} fontSize={10} textAnchor="end" fill="#5a626c">
                {id === selected ? 'selected' : ''}
                {id === oracleBest ? (id === selected ? ' · ' : '') + 'oracle-best' : ''}
              </text>
              <line x1={PAD.l} x2={W - PAD.r} y1={cy} y2={cy} stroke="#e7e2d6" strokeWidth={1} />
              <circle cx={x(est)} cy={cy} r={9} fill="#fff" stroke="#1d232b" strokeWidth={2.5} />
              <text x={x(est)} y={cy - 15} fontSize={10} textAnchor="middle" fill="#1d232b">
                {formatValue(est, 4)}
              </text>
              {orc !== undefined && (
                <g>
                  <circle cx={x(orc)} cy={cy} r={7.5} fill="#1d232b" />
                  <circle cx={x(orc)} cy={cy} r={11.5} fill="none" stroke="#1d232b" strokeWidth={1.5} />
                  <text x={x(orc)} y={cy + 25} fontSize={10} textAnchor="middle" fill="#1d232b">
                    {formatValue(orc, 4)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" fill="#fff" stroke="#1d232b" strokeWidth="2.5" />
          </svg>
          Limited estimate (visited-mass renormalized; not an expectation). “selected” = chosen by the limited estimate.
        </span>
        {oracle && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="9" cy="9" r="4" fill="#1d232b" />
              <circle cx="9" cy="9" r="7" fill="none" stroke="#1d232b" strokeWidth="1.5" />
            </svg>
            Synthetic oracle value
          </span>
        )}
      </figcaption>
      <p className="mt-1 text-xs font-medium text-warn">
        The axis is scaled only to the plotted values, so a wide-looking gap can be a very small difference. Read the exact values, not the distance.
      </p>
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">Exact values</summary>
        <div className="max-w-full overflow-x-auto">
        <table className="mono mt-1">
          <caption className="sr-only">Estimated and oracle policy values</caption>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <th scope="row" className="pr-4 text-left font-normal">
                  {id}
                </th>
                <td className="pr-4">estimate {formatExact(estimates[id])}</td>
                {oracle && <td>oracle {formatExact(oracle[id])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </figure>
  );
}

/** Synthetic oracle. Absent for human sessions and when not requested: never zeros. */
export function OraclePanel({ oracle, human = false }: { oracle: Comparison['oracle']; human?: boolean }) {
  if (oracle === null) {
    return (
      <section className="rounded-lg border border-rule bg-paper-2 p-3" aria-label="Synthetic oracle">
        <p className="text-sm">
          <strong>No oracle result{human ? ': not available for human sessions.' : '.'}</strong>{' '}
          <span className="text-muted">
            {human
              ? 'A synthetic oracle needs a simulator’s private model, so no regret or value-error metrics exist here. This is an absence, not a zero.'
              : 'It was not requested, or this is a human session. No regret or value-error metrics were computed. This is an absence, not a zero.'}
          </span>
        </p>
      </section>
    );
  }
  const values = numberRecord(oracle.policy_values);
  const known = new Set(['policy_values', 'best_policy', 'exact_tie', 'meaning']);
  const rest = Object.fromEntries(Object.entries(oracle).filter(([k]) => !known.has(k)));
  return (
    <section className="surface-oracle p-4" aria-label="Synthetic oracle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Synthetic oracle</h3>
        <EvidenceLabel tone="oracle">Synthetic reference · not human truth</EvidenceLabel>
      </div>
      {typeof oracle.meaning === 'string' && <p className="mt-1 text-sm">{oracle.meaning}</p>}
      <p className="mt-1 text-xs text-muted">
        Exhaustive under this simulator’s private model and shared transition and utility rules. Simulator-dependent; not an expectation over real people.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {values &&
          Object.entries(values).map(([id, v]) => (
            <div key={id}>
              <dt className="text-xs text-muted">{policyLabel(id)} value</dt>
              <dd className="mono" title={formatExact(v)}>
                {formatValue(v, 6)}
              </dd>
            </div>
          ))}
        {oracle.best_policy !== undefined && (
          <div>
            <dt className="text-xs text-muted">Oracle-best policy</dt>
            <dd className="font-medium">{policyLabel(String(oracle.best_policy))}</dd>
          </div>
        )}
        {oracle.exact_tie !== undefined && (
          <div>
            <dt className="text-xs text-muted">Exact tie</dt>
            <dd className="mono">{String(oracle.exact_tie)}</dd>
          </div>
        )}
      </dl>
      {Object.keys(rest).length > 0 && <RawJson data={rest} label="Other oracle fields (verbatim)" />}
    </section>
  );
}

const METRIC_LABEL: Record<string, string> = {
  regret: 'Regret (oracle value lost by the limited selection)',
  best_policy_correct: 'Limited selection is the oracle-best policy',
  selected_policy: 'Selected by the limited estimate',
  oracle_best_policy: 'Oracle-best policy',
  value_mae: 'Mean absolute error of the value estimates',
  value_rmse: 'Root-mean-square error of the value estimates',
  rank_agreement: 'Rank agreement',
  oracle_margin: 'Oracle value margin between the two policies',
  allocator: 'Allocator',
  budget: 'Budget',
  expansions: 'Expansions',
  expanded_first_reaction_count: 'First reactions expanded',
};

/** Readable form of one scalar metric; the exact value stays in the title and the verbatim block. */
function metricText(k: string, v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
  if (typeof v === 'string' && (k === 'selected_policy' || k === 'oracle_best_policy')) return policyLabel(v);
  return String(v);
}

/** Evaluation metrics, only when an oracle produced them: labelled and rounded, with every field verbatim behind a disclosure. */
export function MetricsPanel({ metrics }: { metrics: Comparison['metrics'] }) {
  if (metrics === null) {
    return (
      <section className="rounded-lg border border-rule bg-paper-2 p-4" aria-label="Evaluation metrics">
        <h3 className="text-lg">Evaluation metrics</h3>
        <p className="mt-1 text-sm">
          <strong>Absent.</strong> Regret, value error and rank agreement are defined only against a synthetic oracle, which was not available for this
          comparison. Nothing was computed, so none of these is zero.
        </p>
      </section>
    );
  }
  const correct = metrics.best_policy_correct;
  // Scalars first in a readable table; nested objects/arrays stay verbatim behind a disclosure.
  const PRIORITY = ['regret', 'best_policy_correct', 'selected_policy', 'oracle_best_policy', 'value_mae', 'value_rmse', 'rank_agreement', 'oracle_margin', 'allocator', 'budget', 'expansions'];
  const scalar = Object.entries(metrics).filter(([, v]) => v === null || typeof v !== 'object');
  const nested = Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== null && typeof v === 'object'));
  scalar.sort(([a], [b]) => {
    const ia = PRIORITY.indexOf(a);
    const ib = PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <section className="rounded-lg border border-rule bg-white p-4" aria-label="Evaluation metrics">
      <h3 className="text-lg">Evaluation metrics (versus the synthetic oracle)</h3>
      {correct === false && (
        <p className="mt-1 rounded border-2 border-warn bg-warn-soft p-2 text-sm font-medium">
          The limited selection disagreed with the synthetic reference for this root. This outcome is shown with equal prominence to agreements.
        </p>
      )}
      {correct === true && <p className="mt-1 text-sm">The limited selection agreed with the synthetic reference for this root (no claim beyond this root and simulator).</p>}
      <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {scalar.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-rule/50 py-0.5">
            <dt className="text-muted">
              {METRIC_LABEL[k] ? (
                <>
                  {METRIC_LABEL[k]} <span className="mono text-xs">{k}</span>
                </>
              ) : (
                <span className="mono">{k}</span>
              )}
            </dt>
            <dd className="mono break-all text-right" title={String(v)}>
              {metricText(k, v)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-muted">Numbers are rounded to four significant digits here; hover a value, or open the block below, for the exact figure.</p>
      <div className="mt-2">
        <RawJson
          data={metrics}
          label={`All metric fields exactly as returned${Object.keys(nested).length > 0 ? ' (including per-policy values, depth counts and expansion order)' : ''}`}
        />
      </div>
    </section>
  );
}

export function EstimatesPanel({ comparison, human = false }: { comparison: Comparison; human?: boolean }) {
  const { result } = comparison;
  const oracleValues = comparison.oracle ? numberRecord(comparison.oracle.policy_values) : null;
  const oracleBest = comparison.oracle && typeof comparison.oracle.best_policy === 'string' ? comparison.oracle.best_policy : null;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#6f8ea3] bg-white p-4" aria-label="Limited policy estimates">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg">Limited policy estimates</h3>
          <EvidenceLabel tone="hypothetical">Hypothetical · estimate</EvidenceLabel>
        </div>
        <p className="mt-1 text-sm">
          Selected by the limited estimate: <strong>{policyLabel(result.selected_policy)}</strong>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Each estimate renormalizes only the visited probability mass at each depth and sums the depths available. It is not an unbiased full-tree expectation,
          and estimates from different budgets are not on a common scale. Selecting a policy is an engineering outcome in this simulation, not a recommendation
          about what anyone should eat.
        </p>
        <div className="mt-3">
          <ValueDotPlot estimates={result.estimated_policy_values} selected={result.selected_policy} oracle={oracleValues} oracleBest={oracleBest} />
        </div>
      </section>
      <OraclePanel oracle={comparison.oracle} human={human} />
      {(comparison.oracle !== null || comparison.metrics !== null) && <MetricsPanel metrics={comparison.metrics} />}
    </div>
  );
}
