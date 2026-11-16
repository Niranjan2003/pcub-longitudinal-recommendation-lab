import type { BranchResult, Costs } from '@/api/schemas';
import { formatCount, shortHash } from '@/domain/format';

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mono" title={hint}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Three distinct accounting groups, never merged:
 *  1. logical engine counters (NOT provider calls)
 *  2. provider work: preparation vs evaluation (null = unknown, never 0)
 * "Cache/recorded reuse is not a fresh charge" is stated explicitly.
 */
export function CostLedger({ costs, result }: { costs: Costs; result: BranchResult }) {
  const p = costs.preparation;
  const e = costs.evaluation;
  const c = costs.combined;
  return (
    <section className="surface p-4" aria-label="Cost ledger">
      <h3 className="text-lg">Cost ledger</h3>
      <p className="mt-1 text-sm text-muted">
        Preparation evaluates the <strong>full 20-node forest</strong> before the budgeted evaluation, so a budget-{result.budget} comparison is a bounded
        <em> evaluation</em>, not the total work of the request. Unknown values are shown as “unknown”, never zero.
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="rounded border border-rule p-3">
          <h4 className="text-sm font-semibold">1 · Logical engine counters</h4>
          <p className="text-xs text-muted">Internal simulation work. These are not provider calls and not a cost.</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Expansions" value={String(result.actual_expansions)} />
            <Row label="Recommender calls" value={String(result.recommender_calls)} hint="Logical, includes the two root recommendations" />
            <Row label="Predictor calls" value={String(result.predictor_calls)} />
            <Row label="Engine llm_calls" value={String(result.llm_calls)} hint="Engine-logical counter; provider cost lives in the ledger on the right" />
            <Row label="Engine llm_tokens" value={String(result.llm_tokens)} />
          </dl>
        </div>
        <div className="rounded border border-rule p-3">
          <h4 className="text-sm font-semibold">2 · Preparation (provider work)</h4>
          <p className="text-xs text-muted">Establishes decision closure for the whole observable forest. New requests only.</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Live calls" value={formatCount(p.live_calls)} />
            <Row label="Reservations" value={formatCount(p.reservations)} />
            <Row label="New tokens" value={formatCount(p.new_tokens)} />
            <Row label="Recorded decisions used" value={p.unique_recorded_decisions !== undefined ? String(p.unique_recorded_decisions) : 'not reported'} />
            <Row label="Decision keys" value={p.decision_keys ? String(p.decision_keys.length) : 'not reported'} />
            <Row label="Decision manifest" value={p.decision_manifest_sha256 ? shortHash(p.decision_manifest_sha256, 10) : 'not reported'} hint={p.decision_manifest_sha256} />
          </dl>
        </div>
        <div className="rounded border border-rule p-3">
          <h4 className="text-sm font-semibold">3 · Evaluation and combined</h4>
          <p className="text-xs text-muted">Evaluation reads sealed decisions and makes no new provider calls.</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Eval live calls" value={formatCount(e.live_calls)} />
            <Row label="Eval new tokens" value={formatCount(e.new_tokens)} />
            <Row label="Eval expansions" value={String(e.expansions)} />
            <Row label="Combined live calls" value={formatCount(c.live_calls)} />
            <Row label="Combined new tokens" value={formatCount(c.new_tokens)} />
          </dl>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Recorded or cached reuse is not a fresh provider charge. A successful zero-call evaluation does not erase preparation work.</p>
    </section>
  );
}
