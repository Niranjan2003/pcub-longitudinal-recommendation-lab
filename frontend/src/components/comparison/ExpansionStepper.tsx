import type { BranchResult } from '@/api/schemas';
import { formatPercent } from '@/domain/format';
import { ReactionTag } from '@/components/viz/ReactionMark';

/**
 * Step through the backend's `expansion_order` exactly as returned. Moving the
 * step only changes which nodes are drawn as expanded; it recomputes nothing.
 */
export function ExpansionStepper({
  result,
  step,
  onStep,
  onSelect,
}: {
  result: BranchResult;
  step: number;
  onStep: (n: number) => void;
  onSelect: (id: string) => void;
}) {
  const total = result.expansion_order.length;
  const byId = new Map(result.nodes.map((n) => [n.node_id, n]));
  const current = step > 0 ? byId.get(result.expansion_order[step - 1] ?? '') : undefined;

  return (
    <section aria-label="Expansion order" className="rounded-lg border border-[#6f8ea3] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Expansion order</h3>
        <p className="text-sm text-muted">
          {result.allocator_id} · {total} of budget {result.budget} expansions
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">
        The allocator chooses <strong>which hypothetical node to expand next</strong>, not which recipe to recommend. Step through the order the backend used.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => onStep(Math.max(0, step - 1))} disabled={step <= 0}>
          ← Previous
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onStep(Math.min(total, step + 1))} disabled={step >= total}>
          Next expansion →
        </button>
        <button type="button" className="btn" onClick={() => onStep(0)} disabled={step === 0}>
          Reset
        </button>
        <button type="button" className="btn" onClick={() => onStep(total)} disabled={step === total}>
          Show all
        </button>
        <span className="mono ml-1 text-sm" aria-live="polite">
          step {step} / {total}
        </span>
      </div>
      {current && (
        <p className="mt-2 text-sm">
          Expansion {step}: <span className="inline-flex flex-wrap items-center gap-1.5">{current.branch_path.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">→</span>}
              <ReactionTag reaction={r} />
            </span>
          ))}</span>
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-sm font-semibold">Order as a table</summary>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-left text-sm">
            <caption className="sr-only">Nodes in expansion order</caption>
            <thead>
              <tr className="border-b border-rule text-xs text-muted">
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Depth</th>
                <th className="py-1 pr-3 font-medium">Path</th>
                <th className="py-1 font-medium">Display probability</th>
              </tr>
            </thead>
            <tbody>
              {result.expansion_order.map((id, i) => {
                const n = byId.get(id);
                return (
                  <tr key={id} className="border-b border-rule/60">
                    <td className="mono py-1 pr-3">{i + 1}</td>
                    <td className="mono py-1 pr-3">{n?.depth ?? '—'}</td>
                    <td className="py-1 pr-3">
                      <button type="button" className="text-left text-teal underline" onClick={() => onSelect(id)}>
                        {n ? n.branch_path.join(' → ') : id}
                      </button>
                    </td>
                    <td className="mono py-1 tabular">{n ? formatPercent(n.calibrated_reaction_probability) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
