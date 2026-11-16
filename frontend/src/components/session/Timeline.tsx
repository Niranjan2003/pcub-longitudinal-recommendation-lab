import type { Session } from '@/api/schemas';
import { positionLabel } from '@/domain/format';
import { ReactionMark } from '@/components/viz/ReactionMark';
import { reactionText } from '@/domain/display';

/**
 * Completed turns grouped by segment. Cancelled recommendations are shown
 * separately and struck through: they were never revealed.
 */
export function Timeline({ session, selected, onSelect }: { session: Session; selected: number | null; onSelect: (i: number | null) => void }) {
  const { history, cancelled, plan } = session;
  const segments = new Map<number, number[]>();
  history.forEach((h, i) => {
    const arr = segments.get(h.position.session_index) ?? [];
    arr.push(i);
    segments.set(h.position.session_index, arr);
  });

  return (
    <nav aria-label="Completed turns" className="text-sm">
      <h3 className="text-lg">Timeline</h3>
      <p className="text-xs text-muted">
        {history.length} of {plan.number_of_sessions * plan.turns_per_session} planned turns completed
      </p>
      {history.length === 0 && <p className="mt-3 text-muted">No completed turns yet. The first recorded reaction appears here.</p>}
      <div className="mt-2 space-y-3">
        {[...segments.entries()].map(([seg, idxs]) => (
          <div key={seg}>
            <p className="mb-1 border-t border-dashed border-rule-strong pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Segment {seg}</p>
            <ol className="m-0 list-none space-y-1 p-0">
              {idxs.map((i) => {
                const h = history[i]!;
                const active = selected === i;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelect(active ? null : i)}
                      className={`w-full rounded-md border px-2 py-1.5 text-left ${active ? 'border-ink bg-paper-2' : 'border-rule bg-white hover:bg-paper'}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="mono text-xs text-muted">{positionLabel(h.position)}</span>
                        {h.reaction && <ReactionMark reaction={h.reaction} size={14} />}
                        <span className="text-xs font-medium">{h.reaction ? reactionText(h.reaction) : 'no reaction'}</span>
                        {h.continuation === 'DISENGAGE' && <span className="evidence-label text-danger">Disengage</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{h.action.selected_item.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {cancelled.length > 0 && (
          <div>
            <p className="mb-1 border-t border-dashed border-rule-strong pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Cancelled</p>
            <ul className="m-0 list-none space-y-1 p-0">
              {cancelled.map((c) => (
                <li key={c.id} className="rounded-md border border-rule bg-paper-2 px-2 py-1.5 text-xs">
                  <span className="line-through">{c.predictor_input.action.selected_item.title}</span>
                  <span className="ml-1 text-muted">— cancelled; no reaction revealed</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </nav>
  );
}
