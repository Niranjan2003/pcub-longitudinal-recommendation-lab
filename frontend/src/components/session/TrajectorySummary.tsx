import type { Session } from '@/api/schemas';
import { STATE_DIMENSIONS } from '@/api/schemas';
import { REACTION_META, REACTION_ORDER } from '@/domain/ontology';
import { formatPercent, formatValue, positionLabel } from '@/domain/format';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { ReactionMark, ReactionTag } from '@/components/viz/ReactionMark';

/**
 * Read-only summary of a closed session, built only from values the backend
 * returned: each recorded turn with its saved forecast and realized reaction,
 * and the final engineered state. The headline tallies are plain counts of the
 * returned history (how many turns ended in each reaction / continuation flag);
 * no score, rate or accuracy measure is computed.
 */
export function TrajectorySummary({ session }: { session: Session }) {
  const { history, evidence, plan, state } = session;
  const planned = plan.number_of_sessions * plan.turns_per_session;
  const synthetic = session.world_kind === 'synthetic_simulation';
  const reactionCount = (r: string) => history.filter((h) => h.reaction === r).length;
  const continued = history.filter((h) => h.continuation === 'CONTINUE').length;
  const disengaged = history.filter((h) => h.continuation === 'DISENGAGE').length;
  const segments = Array.from({ length: plan.number_of_sessions }, (_, i) => i + 1);

  return (
    <section className="surface p-4 sm:p-5" aria-labelledby="trajectory-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="trajectory-summary" className="text-xl">
          Trajectory summary
        </h3>
        <EvidenceLabel tone={synthetic ? 'synthetic' : 'human'}>{synthetic ? 'Synthetic · factual in simulation' : 'Human-submitted · factual'}</EvidenceLabel>
      </div>

      {/* Headline */}
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Turns completed</dt>
          <dd className="font-serif text-2xl font-semibold">
            {history.length}/{planned}
          </dd>
        </div>
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Plan</dt>
          <dd className="font-medium">
            {plan.number_of_sessions} segments × {plan.turns_per_session} turns
          </dd>
        </div>
        <div className="col-span-2 rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Realized reactions (count of turns)</dt>
          <dd className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
            {REACTION_ORDER.map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5 text-sm">
                <ReactionMark reaction={r} size={13} />
                {REACTION_META[r].label} <span className="mono font-semibold">{reactionCount(r)}</span>
              </span>
            ))}
          </dd>
        </div>
        <div className="col-span-2 rounded border border-rule bg-card px-3 py-2 sm:col-span-4">
          <dt className="text-xs text-muted">Continuation flags</dt>
          <dd className="text-sm">
            Continue <span className="mono font-semibold">{continued}</span> · Disengage <span className="mono font-semibold">{disengaged}</span>
            {synthetic && disengaged > 0 && <span className="text-xs text-muted"> (in a synthetic session the flag is recorded; only the plan ends the session)</span>}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-muted">
        {history.length} of {planned} planned turns recorded. Each row pairs the forecast saved before the reaction with the reaction that followed, as returned
        by the backend. No accuracy score is computed.
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Recorded turns with forecast and realized reaction</caption>
          <thead>
            <tr className="border-b border-rule text-xs text-muted">
              <th className="py-1 pr-3 font-medium">Turn</th>
              <th className="py-1 pr-3 font-medium">Recipe</th>
              <th className="py-1 pr-3 font-medium">Forecast before reveal (A · M · D · R)</th>
              <th className="py-1 pr-3 font-medium">Realized reaction</th>
              <th className="py-1 pr-3 font-medium">Continuation</th>
            </tr>
          </thead>
          {segments.map((seg) => {
            const rows = history.map((h, i) => ({ h, i })).filter(({ h }) => h.position.session_index === seg);
            if (rows.length === 0) return null;
            return (
              <tbody key={seg}>
                <tr className="bg-paper-2">
                  <th colSpan={5} scope="colgroup" className="px-1 py-1 text-xs font-semibold">
                    Segment {seg}
                  </th>
                </tr>
                {rows.map(({ h, i }) => {
                  const forecast = evidence[i]?.forecast.probabilities;
                  return (
                    <tr key={i} className="border-b border-rule/60 align-top">
                      <td className="mono py-1 pr-3 text-xs">{positionLabel(h.position)}</td>
                      <td className="py-1 pr-3">{h.action.selected_item.title}</td>
                      <td className="mono py-1 pr-3 text-xs">
                        {forecast
                          ? REACTION_ORDER.map((r, k) => (
                              <span key={r} className={h.reaction === r ? 'font-bold text-ink' : 'text-muted'}>
                                {k > 0 && ' · '}
                                {formatPercent(forecast[k]!)}
                              </span>
                            ))
                          : '—'}
                      </td>
                      <td className="py-1 pr-3">{h.reaction ? <ReactionTag reaction={h.reaction} size={12} /> : 'no reaction'}</td>
                      <td className="py-1 pr-3 text-xs">{h.continuation === 'DISENGAGE' ? 'Disengage' : h.continuation === 'CONTINUE' ? 'Continue' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="mt-1 text-xs text-muted">Bold: the forecast probability of the reaction that was realized. Order: Accept · Modify / clarify · Defer · Reject.</p>

      <h4 className="mt-4 text-base font-semibold">Engineered state after the last recorded turn</h4>
      <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-3">
        {STATE_DIMENSIONS.map((d) => (
          <div key={d} className="flex justify-between gap-2">
            <dt className="capitalize text-muted">{d}</dt>
            <dd className="mono">{formatValue(state[d], 3)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-muted">Simulation variables as returned by the backend; they are not measurements of a person.</p>
    </section>
  );
}
