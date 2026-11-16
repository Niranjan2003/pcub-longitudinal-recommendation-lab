import type { HistoryEntry, Reaction, Session, StateDimension } from '@/api/schemas';
import { STATE_DIMENSIONS } from '@/api/schemas';
import { REACTION_META } from '@/domain/ontology';
import { formatValue } from '@/domain/format';
import type { StateObservation } from '@/state/stateLog';

const W = 210;
const H = 92;
const PAD = { l: 26, r: 8, t: 8, b: 18 };

const DIM_BLURB: Record<StateDimension, string> = {
  trust: 'Trust',
  motivation: 'Motivation',
  fatigue: 'Fatigue',
  satisfaction: 'Satisfaction',
  engagement: 'Engagement',
  resistance: 'Resistance',
};

function Marker({ x, y, reaction }: { x: number; y: number; reaction: Reaction | null }) {
  if (!reaction) return <circle cx={x} cy={y} r={3.5} fill="#fff" stroke="#1d232b" strokeWidth={1.5} />;
  const m = REACTION_META[reaction];
  const c = { fill: m.color, stroke: '#1d232b', strokeWidth: 1.2 } as const;
  const r = 4.2;
  if (m.shape === 'circle') return <circle cx={x} cy={y} r={r} {...c} />;
  if (m.shape === 'diamond') return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...c} />;
  if (m.shape === 'square') return <rect x={x - r + 0.4} y={y - r + 0.4} width={2 * r - 0.8} height={2 * r - 0.8} {...c} />;
  return <polygon points={`${x},${y - r - 0.5} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...c} />;
}

/**
 * Six engineered state variables over completed turns. Y axes are fixed to the
 * variables' documented [0,1] range. Only values this browser actually
 * observed in backend responses are plotted (no interpolation, no computing).
 */
export function StateSmallMultiples({
  observations,
  history,
  plan,
}: {
  observations: readonly StateObservation[];
  history: readonly HistoryEntry[];
  plan: Session['plan'];
}) {
  const horizon = plan.number_of_sessions * plan.turns_per_session;
  const xAt = (n: number) => PAD.l + (n / Math.max(horizon, 1)) * (W - PAD.l - PAD.r);
  const yAt = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const rules = Array.from({ length: plan.number_of_sessions - 1 }, (_, i) => (i + 1) * plan.turns_per_session);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {STATE_DIMENSIONS.map((dim) => {
          const pts = observations.map((o) => ({ n: o.completed, v: o.state[dim] }));
          return (
            <figure key={dim} className="m-0 rounded border border-rule bg-white p-1.5">
              <figcaption className="flex justify-between px-1 text-xs font-semibold">
                <span>{DIM_BLURB[dim]}</span>
                {pts.length > 0 && <span className="mono font-normal text-muted">{formatValue(pts[pts.length - 1]!.v, 3)}</span>}
              </figcaption>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${DIM_BLURB[dim]} over completed turns`} className="block w-full">
                {[0, 0.5, 1].map((t) => (
                  <g key={t}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t)} y2={yAt(t)} stroke="#d8d3c8" strokeWidth={t === 0.5 ? 0.6 : 1} strokeDasharray={t === 0.5 ? '2 3' : undefined} />
                    <text x={PAD.l - 4} y={yAt(t) + 3} textAnchor="end" fontSize={9} fill="#5a626c">
                      {t}
                    </text>
                  </g>
                ))}
                {rules.map((n) => (
                  <line key={n} x1={xAt(n)} x2={xAt(n)} y1={PAD.t} y2={H - PAD.b} stroke="#8a8372" strokeWidth={1} strokeDasharray="4 3" />
                ))}
                <text x={xAt(0)} y={H - 5} fontSize={9} fill="#5a626c" textAnchor="start">
                  start
                </text>
                <text x={xAt(horizon)} y={H - 5} fontSize={9} fill="#5a626c" textAnchor="end">
                  turn {horizon}
                </text>
                {pts.slice(1).map((p, i) => {
                  const a = pts[i]!;
                  return (
                    <line
                      key={p.n}
                      x1={xAt(a.n)}
                      y1={yAt(a.v)}
                      x2={xAt(p.n)}
                      y2={yAt(p.v)}
                      stroke="#1d232b"
                      strokeWidth={1.4}
                      strokeDasharray={p.n - a.n > 1 ? '3 3' : undefined}
                    />
                  );
                })}
                {pts.map((p) => (
                  <Marker key={p.n} x={xAt(p.n)} y={yAt(p.v)} reaction={p.n === 0 ? null : (history[p.n - 1]?.reaction ?? null)} />
                ))}
              </svg>
            </figure>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        Points are the values this browser observed from the backend after each completed turn; marker shape is the reaction that preceded the point (hollow
        circle = initial state). Dashed segments span turns this browser did not observe. Dashed vertical lines mark segment boundaries.
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer select-none text-muted">Observed values as a table</summary>
        <div className="overflow-x-auto">
          <table className="mono mt-1 w-full text-left">
            <caption className="sr-only">Observed state values by completed turns</caption>
            <thead>
              <tr>
                <th className="pr-3 font-normal">turns</th>
                {STATE_DIMENSIONS.map((d) => (
                  <th key={d} className="pr-3 font-normal">
                    {d.slice(0, 5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.completed}>
                  <td className="pr-3">{o.completed}</td>
                  {STATE_DIMENSIONS.map((d) => (
                    <td key={d} className="pr-3">
                      {formatValue(o.state[d], 4)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
