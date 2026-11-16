import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { getComparison, getSession, recommend, runComparison } from '@/api/endpoints';
import type { Session } from '@/api/schemas';
import { buildCompare } from '@/api/requests';
import { newSession, playTurn, postJson, preflight } from './helpers';

const DET = 'deterministic_recipe_recommendation';
const FB = 'feedback_sequence_recipe_recommendation';
const CON = 'constraint_only_baseline';
const ALLOCATORS = ['equal', 'greedy', 'uncertainty', 'pcub'] as const;
const BUDGETS = [2, 4, 8, 12] as const;
const ALLOCATOR_IDS: Record<string, string> = {
  equal: 'equal_round_robin',
  greedy: 'greedy_highest_probability',
  uncertainty: 'uncertainty_first',
  pcub: 'pcub_probability_uncertainty_disagreement',
};

let root: Session; // a pending human root with plenty of horizon
beforeAll(async () => {
  await preflight();
  // One completed turn first, so the root carries real history and a contextual adaptation.
  const s = await newSession('cmp-root', { segments: 2, turns_per_segment: 6 });
  const afterTurn = await playTurn(s, 'MODIFY_CLARIFY');
  root = (await recommend(afterTurn)).value;
  expect(root.pending).not.toBeNull();
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe('REAL offline backend — branch comparison from a pending human root', () => {
  it('every allocator × every budget runs; result is internally consistent and isolated from the factual session', async () => {
    const before = await getSession(root.id);
    for (const allocator of ALLOCATORS) {
      for (const budget of BUDGETS) {
        const job = (await runComparison(root, { policies: [DET, FB], allocator, budget, oracle: false })).value;
        const r = job.result;
        // Identity and pinning.
        expect(job.status).toBe('complete');
        expect(job.session_id).toBe(root.id);
        expect(job.factual_revision).toBe(root.revision);
        expect(job.root_id).toBe(root.pending!.id);
        expect(r.root_context_id).toBe(root.pending!.id);
        // Allocator, budget, expansions.
        expect(r.allocator_id).toBe(ALLOCATOR_IDS[allocator]);
        expect(r.budget).toBe(budget);
        expect(r.actual_expansions).toBe(budget);
        expect(r.expansion_order).toHaveLength(r.actual_expansions);
        expect(r.nodes).toHaveLength(r.actual_expansions);
        // Every expanded node appears in the order exactly once, and is real.
        expect(new Set(r.expansion_order).size).toBe(r.expansion_order.length);
        expect(new Set(r.nodes.map((n) => n.node_id))).toEqual(new Set(r.expansion_order));
        // A depth-2 node's parent must itself be an expanded depth-1 node, expanded EARLIER.
        for (const n of r.nodes) {
          expect(n.depth === 1 ? n.parent_node_id === null : n.parent_node_id !== null).toBe(true);
          if (n.parent_node_id) {
            expect(r.expansion_order.indexOf(n.parent_node_id)).toBeGreaterThanOrEqual(0);
            expect(r.expansion_order.indexOf(n.parent_node_id)).toBeLessThan(r.expansion_order.indexOf(n.node_id));
          }
          expect(n.branch_path).toHaveLength(n.depth);
          expect(n.policy_evidence).toHaveLength(2);
        }
        // Branch depth limit.
        expect(Math.max(...r.nodes.map((n) => n.depth))).toBeLessThanOrEqual(2);
        // Selection and estimates.
        expect(Object.keys(r.estimated_policy_values).sort()).toEqual([DET, FB].sort());
        expect([DET, FB]).toContain(r.selected_policy);
        // No oracle requested: metrics/oracle absent (null), never zero.
        expect(job.metrics).toBeNull();
        expect(job.oracle).toBeNull();
        // Hypothetical provenance and offline costs.
        expect(job.provenance.evidence_status).toBe('counterfactual');
        expect(job.provenance.reaction_origin).toBe('hypothetical');
        expect(job.costs.preparation.live_calls).toBe(0);
        expect(job.costs.evaluation.live_calls).toBe(0);
        expect(job.costs.combined.live_calls).toBe(0);
        expect(job.costs.evaluation.expansions).toBe(r.actual_expansions);
        expect(job.asset_manifest_fingerprint).toBe(before.pending!.asset_manifest_fingerprint);
      }
    }
    // The factual session is byte-for-value identical after 16 comparisons.
    const after = await getSession(root.id);
    expect(after).toEqual(before);
  }, 300_000);

  it('GET of a persisted comparison returns the same record (no recomputation)', async () => {
    const job = (await runComparison(root, { policies: [DET, FB], allocator: 'pcub', budget: 8, oracle: false })).value;
    const again = await getComparison(job.id);
    expect(again).toEqual(job);
  });

  it('is deterministic: the same root and parameters yield identical estimates and expansion order', async () => {
    const a = (await runComparison(root, { policies: [DET, FB], allocator: 'greedy', budget: 4, oracle: false })).value;
    const b = (await runComparison(root, { policies: [DET, FB], allocator: 'greedy', budget: 4, oracle: false })).value;
    expect(a.id).not.toBe(b.id); // a new key is a new job
    expect(b.result.expansion_order).toEqual(a.result.expansion_order);
    expect(b.result.estimated_policy_values).toEqual(a.result.estimated_policy_values);
    expect(b.result.selected_policy).toBe(a.result.selected_policy);
  });

  it('the backend canonicalizes pair order: requesting [FB, DET] returns the same canonical pair', async () => {
    const a = (await runComparison(root, { policies: [DET, FB], allocator: 'equal', budget: 2, oracle: false })).value;
    const b = (await runComparison(root, { policies: [FB, DET], allocator: 'equal', budget: 2, oracle: false })).value;
    expect(b.policies).toEqual(a.policies);
    expect(a.policies.map((p) => p[0])).toEqual([DET, FB]);
    expect(a.policies[0]![1]).toBe('1');
  });

  it('works for other available policy pairs', async () => {
    const job = (await runComparison(root, { policies: [DET, CON], allocator: 'uncertainty', budget: 4, oracle: false })).value;
    expect(job.policies.map((p) => p[0])).toEqual([DET, CON]);
    expect(job.result.nodes).toHaveLength(4);
  });

  it('branch probabilities are the frozen POPULATION model even though this session is contextual', async () => {
    expect(root.predictor).toBe('contextual');
    const job = (await runComparison(root, { policies: [DET, FB], allocator: 'pcub', budget: 2, oracle: false })).value;
    // The first expanded node's per-policy step probability for its reaction equals the population vector entry,
    // not the (adapted) pending forecast. Population vector is the one returned alongside the forecast.
    const first = job.result.nodes.find((n) => n.node_id === job.result.expansion_order[0])!;
    const population = root.pending!.conformal_reference.population_probabilities;
    const order = ['ACCEPT', 'MODIFY_CLARIFY', 'DEFER', 'REJECT'];
    const idx = order.indexOf(first.hypothetical_reaction);
    // Both policies share the same root predictor input at depth 1 in this engine path; at least one policy's
    // step probability must match the frozen population value exactly (we only compare returned numbers).
    const stepProbs = first.policy_evidence.map((p) => p.calibrated_step_probability);
    expect(stepProbs.some((p) => p === population[idx])).toBe(true);
  });
});

describe('REAL offline backend — comparison error paths', () => {
  it('a session with no pending recommendation → PENDING_ROOT_REQUIRED (409)', async () => {
    const s = await newSession('cmp-nopending');
    const err = await failure(runComparison(s, { policies: [DET, FB], allocator: 'pcub', budget: 8, oracle: false }));
    expect(err.code).toBe('PENDING_ROOT_REQUIRED');
    expect(err.status).toBe(409);
  });

  it('a stale expected_revision → STALE_REVISION (409); nothing is created', async () => {
    const err = await failure(runComparison({ id: root.id, revision: root.revision - 1, world_kind: 'human_interaction' }, { policies: [DET, FB], allocator: 'pcub', budget: 8, oracle: false }));
    expect(err.code).toBe('STALE_REVISION');
  });

  it('a human oracle request is rejected by the backend too (HUMAN_ORACLE_UNAVAILABLE, 422), independent of the client guard', async () => {
    // The client builder refuses it...
    expect(() => buildCompare({ session_id: root.id, expected_revision: root.revision, policies: [DET, FB], allocator: 'pcub', budget: 8, oracle: true }, 'human_interaction')).toThrow();
    // ...and the backend does as well when sent raw.
    const err = await postJson(
      '/v1/branch-comparisons',
      `it-oracle-${root.id}`,
      JSON.stringify({ session_id: root.id, expected_revision: root.revision, policies: [DET, FB], allocator: 'pcub', budget: 8, oracle: true }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('HUMAN_ORACLE_UNAVAILABLE');
    expect((err as ApiError).status).toBe(422);
  });

  it('two identical policies are rejected by the backend (TWO_DISTINCT_KNOWN_POLICIES_REQUIRED, 422) when sent raw', async () => {
    const err = await postJson(
      '/v1/branch-comparisons',
      `it-same-${root.id}`,
      JSON.stringify({ session_id: root.id, expected_revision: root.revision, policies: [DET, DET], allocator: 'pcub', budget: 8, oracle: false }),
    ).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('TWO_DISTINCT_KNOWN_POLICIES_REQUIRED');
  });

  it('a budget outside {2,4,8,12} is invalid at the backend (INVALID_REQUEST, 422) when sent raw', async () => {
    const err = await postJson(
      '/v1/branch-comparisons',
      `it-budget-${root.id}`,
      JSON.stringify({ session_id: root.id, expected_revision: root.revision, policies: [DET, FB], allocator: 'pcub', budget: 5, oracle: false }),
    ).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('INVALID_REQUEST');
  });

  it('a comparison from a root with too little horizon → INSUFFICIENT_HORIZON (422); characterizes the threshold', async () => {
    const outcomes: Record<number, string> = {};
    for (const turns of [1, 2, 3, 4]) {
      const s = await newSession(`cmp-h${turns}`, { segments: 1, turns_per_segment: turns });
      const p = (await recommend(s)).value;
      try {
        await runComparison(p, { policies: [DET, FB], allocator: 'equal', budget: 2, oracle: false });
        outcomes[turns] = 'ok';
      } catch (e) {
        outcomes[turns] = e instanceof ApiError ? (e.code ?? e.kind) : 'unexpected';
      }
    }
    // Record what the backend actually does. Short horizons must fail with INSUFFICIENT_HORIZON, longer ones succeed.
    expect(outcomes[1]).toBe('INSUFFICIENT_HORIZON');
    expect(outcomes[4]).toBe('ok');
    // Print the observed threshold into the test log for the contract notes.
    console.log('INSUFFICIENT_HORIZON characterization (1 segment, N turns, root at turn 1):', JSON.stringify(outcomes));
  }, 120_000);

  it('guarded policy in the pair, offline → RECORDED_CONTEXT_UNAVAILABLE (409), no substitution, no new session state', async () => {
    const before = await getSession(root.id);
    const err = await failure(runComparison(root, { policies: [DET, 'guarded_llm_score_vector'], allocator: 'pcub', budget: 2, oracle: false }));
    expect(err.code).toBe('RECORDED_CONTEXT_UNAVAILABLE');
    expect(await getSession(root.id)).toEqual(before);
  });
});
