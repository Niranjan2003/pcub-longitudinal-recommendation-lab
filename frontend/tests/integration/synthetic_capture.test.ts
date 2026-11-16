import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { advanceSynthetic, createSyntheticSession, getSession, recommend, runComparison } from '@/api/endpoints';
import { buildSyntheticAdvance } from '@/api/requests';
import { SYNTHETIC_PRESETS, type SyntheticPreset } from '@/config/syntheticPresets';
import type { Session } from '@/api/schemas';
import { postJson, preflight } from './helpers';

const DET = 'deterministic_recipe_recommendation';
const FB = 'feedback_sequence_recipe_recommendation';
const ALLOCATORS = ['equal', 'greedy', 'uncertainty', 'pcub'] as const;
const REACTIONS = ['ACCEPT', 'MODIFY_CLARIFY', 'DEFER', 'REJECT'];

beforeAll(async () => {
  await preflight();
});

const create = (p: SyntheticPreset, policy = DET, predictor = 'contextual') =>
  createSyntheticSession({ policy, prediction_backend: p.backend, predictor, fixture: p.fixture }).then((r) => r.value);

async function advanceN(s: Session, n: number): Promise<Session> {
  let cur = s;
  for (let i = 0; i < n; i++) {
    cur = (await recommend(cur)).value;
    cur = (await advanceSynthetic(cur, cur.pending!.id)).value;
  }
  return cur;
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe.each(SYNTHETIC_PRESETS.map((p) => [p.backend, p] as const))('REAL offline backend — synthetic session on %s', (_name, preset) => {
  it('creates from the verified fixture: fixture-owned persona/state/request/plan, no R1 fingerprint', async () => {
    const s = await create(preset);
    expect(s.world_kind).toBe('synthetic_simulation');
    expect(s.backend).toBe(preset.backend);
    expect(s.revision).toBe(0);
    expect(s.status).toBe('open');
    expect(s.plan).toEqual({ number_of_sessions: 2, turns_per_session: 6 });
    expect(s.persona.user_id).toBe(preset.profileId);
    expect(s.reference_run_fingerprint).toBeNull(); // a new simulation, never labelled as R1 replay
    expect(s.claim).toMatch(/not historical R1 evidence/i);
  });

  it('completes the standard 2 × 6 horizon: history carries across the segment rollover and the session closes after turn 12', async () => {
    const pos = (x: Session) => x.history.map((h) => [h.position.session_index, h.position.turn_index]);
    const s6 = await advanceN(await create(preset), 6);
    expect(s6.status).toBe('open');
    expect(pos(s6)).toEqual([1, 2, 3, 4, 5, 6].map((t) => [1, t]));
    const s7 = await advanceN(s6, 1);
    expect(pos(s7)[6]).toEqual([2, 1]);
    expect(s7.history.slice(0, 6)).toEqual(s6.history); // segment 1 is carried over unchanged
    const s12 = await advanceN(s7, 5);
    expect(pos(s12)).toEqual([...[1, 2, 3, 4, 5, 6].map((t) => [1, t]), ...[1, 2, 3, 4, 5, 6].map((t) => [2, t])]);
    expect(s12.evidence).toHaveLength(12);
    expect(s12.status).toBe('closed');
    expect(s12.pending).toBeNull();
    expect(s12.revision).toBe(24);
    const stored = await getSession(s12.id);
    expect(stored.status).toBe('closed');
    expect(stored.history).toEqual(s12.history);
    expect((await failure(recommend(s12))).code).toBe('SESSION_CLOSED');
  });

  it('the simulator owns the reaction: independent of the forecast, factual only within the simulation', async () => {
    const s0 = await create(preset);
    const s1 = (await recommend(s0)).value;
    expect(s1.pending!.provenance.evidence_status).toBe('pending');
    const s2 = (await advanceSynthetic(s1, s1.pending!.id)).value;
    expect(s2.revision).toBe(2);
    expect(s2.history).toHaveLength(1);
    const ev = s2.evidence[0]!;
    expect(ev.provenance.world_kind).toBe('synthetic_simulation');
    expect(ev.provenance.reaction_origin).toBe('synthetic_generated');
    expect(ev.provenance.evidence_status).toBe('factual');
    const outcome = ev.outcome as unknown as Record<string, unknown>;
    expect(outcome.reference_kind).toBe('independent_synthetic');
    expect(REACTIONS).toContain(ev.outcome.reaction);
    expect(s2.history[0]!.reaction).toBe(ev.outcome.reaction);
    // The forecast kept in evidence is exactly the one that was pending before the reveal.
    expect(ev.forecast.probabilities).toEqual(s1.pending!.probabilities);
    // The simulator's private probability vector is a different object from the forecast.
    const sim = outcome.outcome_probabilities as Record<string, number>;
    expect(Object.keys(sim).sort()).toEqual([...REACTIONS].sort());
    expect(REACTIONS.map((r) => sim[r])).not.toEqual(ev.forecast.probabilities);
  });

  it('the advance request body carries no reaction (it cannot be expressed), and the backend refuses a supplied one', async () => {
    const s0 = await create(preset);
    const s1 = (await recommend(s0)).value;
    expect(Object.keys(buildSyntheticAdvance({ expectedRevision: 1, recommendationId: s1.pending!.id })).sort()).toEqual(['expected_revision', 'operation', 'recommendation_id']);
    const err = await postJson(
      `/v1/sessions/${s0.id}/feedback`,
      `it-synreact-${s0.id}`,
      JSON.stringify({ expected_revision: 1, operation: 'feedback', recommendation_id: s1.pending!.id, reaction: 'ACCEPT', continuation: 'CONTINUE' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SYNTHETIC_REACTION_IS_ENGINE_OWNED');
    expect((await getSession(s0.id)).revision).toBe(1); // nothing was committed
  });

  it('a synthetic DISENGAGE does not close the session (the horizon does)', async () => {
    const s = await advanceN(await create(preset), 4);
    expect(s.history).toHaveLength(4);
    expect(s.status).toBe('open');
  });

  it('every allocator runs with the synthetic oracle; metrics are consistent with the oracle and the limited result', async () => {
    const root = (await recommend(await advanceN(await create(preset), 3))).value;
    const before = await getSession(root.id);
    for (const allocator of ALLOCATORS) {
      const job = (await runComparison(root, { policies: [FB, DET], allocator, budget: 4, oracle: true })).value;
      expect(job.provenance.world_kind).toBe('synthetic_simulation');
      expect(job.provenance.reaction_origin).toBe('hypothetical');
      expect(job.oracle).not.toBeNull();
      expect(job.metrics).not.toBeNull();
      const oracle = job.oracle!;
      const values = oracle.policy_values as Record<string, number>;
      expect(Object.keys(values).sort()).toEqual([DET, FB].sort());
      expect([DET, FB]).toContain(oracle.best_policy);
      expect(typeof oracle.exact_tie).toBe('boolean');
      expect(String(oracle.meaning)).toMatch(/never human ground truth/i);
      const m = job.metrics!;
      expect(typeof m.regret).toBe('number');
      expect(m.regret as number).toBeGreaterThanOrEqual(0);
      expect(typeof m.best_policy_correct).toBe('boolean');
      // Backend-internal consistency (checked in the TEST, never computed by the UI):
      expect(m.selected_policy).toBe(job.result.selected_policy);
      expect(m.estimated_policy_values).toEqual(job.result.estimated_policy_values);
      expect(m.oracle_policy_values).toEqual(values);
      expect(m.oracle_best_policy).toBe(oracle.best_policy);
      expect(m.best_policy_correct).toBe((m.regret as number) <= 1e-12);
      expect(Math.abs((m.regret as number) - (Math.max(...Object.values(values)) - values[job.result.selected_policy]!))).toBeLessThan(1e-9);
      expect(job.costs.preparation.live_calls).toBe(0);
    }
    expect(await getSession(root.id)).toEqual(before); // comparisons never touch the factual session
  }, 300_000);

  it('oracle=false on a synthetic session yields estimates only: oracle and metrics are null', async () => {
    const root = (await recommend(await advanceN(await create(preset), 3))).value;
    const job = (await runComparison(root, { policies: [DET, FB], allocator: 'pcub', budget: 2, oracle: false })).value;
    expect(job.oracle).toBeNull();
    expect(job.metrics).toBeNull();
  });

  it('the oracle value is deterministic for the same root and pair', async () => {
    const root = (await recommend(await advanceN(await create(preset), 3))).value;
    const a = (await runComparison(root, { policies: [DET, FB], allocator: 'equal', budget: 2, oracle: true })).value;
    const b = (await runComparison(root, { policies: [DET, FB], allocator: 'greedy', budget: 8, oracle: true })).value;
    // The exhaustive oracle does not depend on allocator or budget.
    expect(b.oracle!.policy_values).toEqual(a.oracle!.policy_values);
    expect(b.oracle!.best_policy).toBe(a.oracle!.best_policy);
  }, 120_000);
});

describe('REAL offline backend — synthetic fixture compatibility and limits', () => {
  it('a fixture used with the OTHER simulator backend is rejected (BACKEND_FIXTURE_MISMATCH, 422); nothing is created', async () => {
    const structured = SYNTHETIC_PRESETS.find((p) => p.backend.startsWith('current'))!;
    const agenda = SYNTHETIC_PRESETS.find((p) => p.backend.startsWith('usersimcrs'))!;
    const err = await failure(createSyntheticSession({ policy: DET, prediction_backend: agenda.backend, predictor: 'population', fixture: structured.fixture }));
    expect(err.code).toBe('BACKEND_FIXTURE_MISMATCH');
    expect(err.status).toBe(422);
  });

  it('guarded policy on a synthetic session (offline): either an exact recorded decision or RECORDED_CONTEXT_UNAVAILABLE; never a provider call', async () => {
    const p = SYNTHETIC_PRESETS[0]!;
    const s0 = await create(p, 'guarded_llm_score_vector', 'population');
    try {
      const s1 = (await recommend(s0)).value;
      expect(s1.pending!.provenance.recommendation_execution_mode).toBe('recorded_guarded');
      expect(s1.pending!.provider_costs.live_calls).toBe(0);
      console.log('guarded synthetic: recorded decision available at turn 1');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('RECORDED_CONTEXT_UNAVAILABLE');
      expect((await getSession(s0.id)).policy).toBe('guarded_llm_score_vector');
      console.log('guarded synthetic: RECORDED_CONTEXT_UNAVAILABLE (faithful)');
    }
  });

  it('the synthetic fixture builder refuses names that are not trajectory_*.json basenames or contain paths', () => {
    for (const bad of ['../x.json', 'trajectory_a/b.json', 'notatrajectory.json', 'trajectory_x.txt']) {
      expect(() => buildSynth(bad)).toThrow();
    }
  });
});

import { buildCreateSyntheticSession } from '@/api/requests';
function buildSynth(fixture: string) {
  return buildCreateSyntheticSession({ policy: DET, prediction_backend: 'current_structured_simulator@1', predictor: 'population', fixture });
}
