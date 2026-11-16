import type { BranchNode } from '@/api/schemas';
import { STATE_DIMENSIONS } from '@/api/schemas';
import { formatExact, formatPercent, formatValue } from '@/domain/format';
import { policyLabel } from '@/domain/ontology';
import { ReactionTag } from '@/components/viz/ReactionMark';

/**
 * Evidence for one hypothetical node, verbatim from the backend: both
 * policies' step and cumulative probabilities, their downstream actions and
 * utility components. No value here is computed by the frontend.
 */
export function NodeDetail({ node, order }: { node: BranchNode; order: number }) {
  return (
    <section className="rounded-lg border border-[#6f8ea3] bg-white p-4" aria-label="Selected hypothetical node">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg">Hypothetical path</h3>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {node.branch_path.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">→</span>}
              <ReactionTag reaction={r} />
            </span>
          ))}
        </span>
        <span className="evidence-label text-[#3d6078]">Expansion #{order + 1}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        A modeled path, not something that happened. All continuations here are CONTINUE, and clarifications carry residual text only.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Display probability (paired mean)</dt>
          <dd className="tabular mono" title={formatExact(node.calibrated_reaction_probability)}>
            {formatPercent(node.calibrated_reaction_probability)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Display cumulative path probability</dt>
          <dd className="tabular mono" title={formatExact(node.cumulative_path_probability)}>
            {formatPercent(node.cumulative_path_probability)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Depth</dt>
          <dd className="mono">{node.depth}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-xs text-muted">Permitted history summary</dt>
          <dd className="mono text-xs">{node.permitted_history_summary.join(' · ') || '—'}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {node.policy_evidence.map((pe) => (
          <div key={pe.policy.identifier} className="rounded border border-rule bg-paper p-3 text-sm">
            <p className="font-semibold">
              {policyLabel(pe.policy.identifier)} <span className="mono text-xs font-normal text-muted">v{pe.policy.version}</span>
            </p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
              <div>
                <dt className="text-xs text-muted">Step probability</dt>
                <dd className="tabular mono" title={formatExact(pe.calibrated_step_probability)}>
                  {formatPercent(pe.calibrated_step_probability)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Cumulative probability</dt>
                <dd className="tabular mono" title={formatExact(pe.calibrated_cumulative_probability)}>
                  {formatPercent(pe.calibrated_cumulative_probability)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">Downstream recommendation under this path</p>
            <p className="font-medium">{pe.downstream_action.selected_item.title}</p>
            <p className="mono text-xs text-muted">recipe {pe.downstream_action.selected_item.item_id}</p>
            <dl className="mt-2 grid grid-cols-3 gap-x-3 text-xs">
              <div>
                <dt className="text-muted">State component</dt>
                <dd className="mono tabular">{formatValue(pe.utility.state_component)}</dd>
              </div>
              <div>
                <dt className="text-muted">Action component</dt>
                <dd className="mono tabular">{formatValue(pe.utility.action_component)}</dd>
              </div>
              <div>
                <dt className="text-muted">Branch utility</dt>
                <dd className="mono tabular font-semibold" title={formatExact(pe.utility.synthetic_branch_utility)}>
                  {formatValue(pe.utility.synthetic_branch_utility)}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Utility is an engineered objective for comparing policies in this simulation, not a measure of human welfare, nutrition or clinical benefit.
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer select-none text-sm font-semibold">
          Hypothetical engineered state after this path (policy “{policyLabel(node.policy_evidence[0]?.policy.identifier ?? '')}”’s branch)
        </summary>
        <table className="mono mt-1 text-xs">
          <caption className="sr-only">Hypothetical state after this path</caption>
          <tbody>
            {STATE_DIMENSIONS.map((d) => (
              <tr key={d}>
                <th scope="row" className="pr-4 text-left font-normal">
                  {d}
                </th>
                <td>{formatValue(node.cloned_dynamic_state[d])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-muted">The engine shows the first policy’s hypothetical state on the node. Engineered variables, not psychological measurements.</p>
      </details>

      <p className="mono mt-2 break-all text-[11px] text-muted">{node.node_id}</p>
    </section>
  );
}
