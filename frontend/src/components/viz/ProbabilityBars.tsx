import type { Reaction } from '@/api/schemas';
import { REACTION_META, REACTION_ORDER } from '@/domain/ontology';
import { formatExact, formatPercent } from '@/domain/format';
import { ReactionMark } from './ReactionMark';

/**
 * Four-class reaction vector in the backend's canonical order. Bar lengths are
 * the returned probabilities (display scaling only). `forecast` styling is
 * hatched with a dashed outline: it is NOT an outcome. `realized` tags the
 * label that actually occurred, when known.
 */
export function ProbabilityBars({
  probabilities,
  variant = 'forecast',
  realized,
  caption,
  compact = false,
}: {
  probabilities: readonly number[];
  variant?: 'forecast' | 'plain';
  realized?: Reaction;
  caption?: string;
  compact?: boolean;
}) {
  return (
    <figure className="m-0">
      {caption && <figcaption className="mb-1.5 text-xs font-medium text-muted">{caption}</figcaption>}
      <ul className="m-0 list-none space-y-1.5 p-0">
        {REACTION_ORDER.map((r, i) => {
          const p = probabilities[i] ?? 0;
          const meta = REACTION_META[r];
          const isRealized = realized === r;
          return (
            <li
              key={r}
              className={`grid items-center gap-2 rounded px-1 ${isRealized ? 'bg-ok-soft ring-2 ring-ok' : ''} ${compact ? 'grid-cols-[92px_1fr_52px]' : 'grid-cols-[132px_1fr_60px]'}`}
              data-realized={isRealized || undefined}
            >
              <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
                <ReactionMark reaction={r} size={14} />
                <span>{compact ? meta.short : meta.label}</span>
                {isRealized && <span className="evidence-label text-ok">Realized</span>}
              </span>
              <span
                className={`relative block rounded-sm bg-paper-2 ${compact ? 'h-4' : 'h-6'} ${variant === 'forecast' ? 'outline-dashed outline-1 outline-ink/60' : ''}`}
                aria-hidden="true"
              >
                <span
                  className={`block h-full rounded-sm ${variant === 'forecast' ? 'hatched opacity-80' : ''}`}
                  style={{
                    width: `${p * 100}%`,
                    minWidth: p > 0 ? 2 : 0,
                    color: meta.color,
                    backgroundColor: variant === 'forecast' ? 'transparent' : meta.color,
                  }}
                />
              </span>
              <span className={`tabular mono text-right ${compact ? 'text-sm' : 'text-base font-semibold'}`} title={`exact: ${formatExact(p)}`}>
                {formatPercent(p)}
              </span>
            </li>
          );
        })}
      </ul>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Exact values</summary>
        <table className="mono mt-1">
          <caption className="sr-only">Reaction probabilities in canonical order</caption>
          <tbody>
            {REACTION_ORDER.map((r, i) => (
              <tr key={r}>
                <th scope="row" className="pr-3 text-left font-normal">
                  {r}
                </th>
                <td>{formatExact(probabilities[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
