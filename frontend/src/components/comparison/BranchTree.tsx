import type { BranchNode, BranchResult, Reaction } from '@/api/schemas';
import { REACTION_META, REACTION_ORDER } from '@/domain/ontology';
import { formatPercent } from '@/domain/format';
import { ReactionMark } from '@/components/viz/ReactionMark';

/**
 * Module-level components (stable identity): defining these inside BranchTree
 * would remount every node on each parent render and swallow clicks.
 */
function NodeButton({
  node,
  order,
  step,
  active,
  onSelect,
  small,
}: {
  node: BranchNode;
  order: readonly string[];
  step: number;
  active: boolean;
  onSelect: (id: string | null) => void;
  small?: boolean;
}) {
  const k = order.indexOf(node.node_id);
  const shown = k < step;
  const meta = REACTION_META[node.hypothetical_reaction];
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${node.branch_path.map((r) => REACTION_META[r].label).join(' then ')}, expansion ${k + 1}, probability ${formatPercent(node.calibrated_reaction_probability)}`}
      onClick={() => onSelect(active ? null : node.node_id)}
      className={`w-full rounded-md border-2 bg-white text-left transition-opacity ${small ? 'px-2 py-1.5' : 'px-3 py-2'} ${
        active ? 'border-ink shadow-md' : 'border-[#6f8ea3]'
      } ${shown ? '' : 'opacity-25'}`}
      style={{ borderStyle: active ? 'solid' : 'dotted' }}
    >
      <span className="flex items-center gap-1.5">
        <ReactionMark reaction={node.hypothetical_reaction} size={small ? 13 : 16} />
        <span className={`font-medium ${small ? 'text-xs' : 'text-sm'}`}>{small ? meta.short : meta.label}</span>
        <span className="evidence-label ml-auto text-[#3d6078]" title="Expansion order">
          #{k + 1}
        </span>
      </span>
      <span className={`tabular mono mt-0.5 block ${small ? 'text-[11px]' : 'text-xs'}`} title="Backend display probability: paired mean across both policies">
        {formatPercent(node.calibrated_reaction_probability)}
      </span>
    </button>
  );
}

function Slot({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-rule-strong bg-white/40 px-2 py-1.5 text-xs text-muted" aria-label={`${label}: not expanded within budget`}>
      <span className="block font-medium">{label}</span>
      <span className="block">not expanded — no estimate</span>
    </div>
  );
}

/**
 * The two-depth hypothetical tree, drawn from `result.nodes` exactly.
 * Nodes the backend expanded are solid cards (numbered by expansion order);
 * slots it did not expand within the budget are faint outlines with NO
 * estimate. Displayed probabilities are the backend's own (the paired mean
 * across both policies); nothing is computed here.
 */
export function BranchTree({
  result,
  step,
  selectedId,
  onSelect,
}: {
  result: BranchResult;
  step: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const order = result.expansion_order;
  const depth1 = (r: Reaction) => result.nodes.find((n) => n.depth === 1 && n.branch_path[0] === r);
  const depth2 = (r1: Reaction, r2: Reaction) => result.nodes.find((n) => n.depth === 2 && n.branch_path[0] === r1 && n.branch_path[1] === r2);

  return (
    <div role="group" aria-label="Hypothetical two-depth reaction tree" className="overflow-x-auto">
      <div className="mx-auto mb-3 w-fit rounded-md border-2 border-ink bg-white px-4 py-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Factual root</p>
        <p className="text-sm font-medium">Pending recommendation</p>
        <p className="mono text-xs text-muted">{result.root_context_id.slice(-7)}</p>
      </div>
      <div className="grid min-w-[760px] grid-cols-4 gap-3 md:min-w-0">
        {REACTION_ORDER.map((r1) => {
          const n1 = depth1(r1);
          return (
            <div key={r1} className="space-y-2">
              <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted">First reaction</p>
              {n1 ? (
                <NodeButton node={n1} order={order} step={step} active={selectedId === n1.node_id} onSelect={onSelect} />
              ) : (
                <Slot label={REACTION_META[r1].label} />
              )}
              <div className="ml-3 space-y-1.5 border-l-2 border-dotted border-[#6f8ea3] pl-2" aria-label={`Second reactions after ${REACTION_META[r1].label}`}>
                {n1 ? (
                  REACTION_ORDER.map((r2) => {
                    const n2 = depth2(r1, r2);
                    return n2 ? (
                      <NodeButton key={r2} node={n2} order={order} step={step} active={selectedId === n2.node_id} onSelect={onSelect} small />
                    ) : (
                      <Slot key={r2} label={`then ${REACTION_META[r2].short}`} />
                    );
                  })
                ) : (
                  <p className="text-xs text-muted">Not reached: no second-reaction nodes.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
