import { beforeAll, describe, expect, it } from 'vitest';
import { configureApi } from '@/api/client';
import { createHumanSession, createSyntheticSession, getCapabilities, getSession, recommend, runComparison } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import { journal } from '@/api/commands/journal';
import { recoverCommand } from '@/api/commands/runCommand';
import { sessionSchema, type Capabilities, type Session } from '@/api/schemas';
import type { CreateHumanSessionInput } from '@/api/requests';
import { SYNTHETIC_PRESETS } from '@/config/syntheticPresets';

/**
 * The real frontend client against the unmodified backend in LIVE mode, with the
 * fake in-process provider of scripts/fake_live_backend.py. Every expectation about
 * provider requests is checked twice: by the backend's own journal accounting and by
 * the harness's independent transport counter (fake_provider_calls).
 */
const BASE_URL = process.env.PCUB_BACKEND_URL ?? 'http://127.0.0.1:8785';
const RUN = `lf${Date.now().toString(36)}`;
const MARKER = 'fake_in_process_test_double';
const GUARDED = 'guarded_llm_score_vector';

type FakeCaps = Capabilities & { provider_transport?: string; fake_provider_calls?: number; fake_live_call_limit?: number };

async function fakeCalls(): Promise<number> {
  return ((await getCapabilities()) as FakeCaps).fake_provider_calls!;
}

function input(name: string, extra: Partial<CreateHumanSessionInput> = {}): CreateHumanSessionInput {
  return {
    policy: GUARDED,
    prediction_backend: 'current_structured_simulator@1',
    predictor: 'population',
    persona: {
      user_id: `${RUN}-${name}`,
      display_name: `Live fake ${name}`,
      dietary_pattern: 'omnivore',
      allergies: ['peanut'],
      excluded_ingredients: [],
      health_goals: [],
      taste_preferences: [],
    },
    request: 'Recommend a safe recipe.',
    segments: 2,
    turns_per_segment: 6,
    ...extra,
  };
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the command to fail');
}

let limit = 0;

beforeAll(async () => {
  if (process.env.PCUB_FAKE_LIVE !== '1') throw new Error('Opt-in suite: run it with vitest.live-fake.config.ts.');
  configureApi({ baseUrl: BASE_URL });
  const caps = (await getCapabilities()) as FakeCaps;
  if (caps.provider_transport !== MARKER) {
    throw new Error(`Refusing to run: ${BASE_URL} is not the fake-provider harness (provider_transport=${String(caps.provider_transport)}). Nothing was sent.`);
  }
  expect(caps.mode).toBe('live_opt_in');
  expect(caps.live_guarded).toBe(true);
  limit = caps.fake_live_call_limit!;
  if (limit < 6) throw new Error('Start the harness with --live-call-limit 6 or more, on a fresh journal.');
});

describe('live guarded recommendations (fake provider)', () => {
  let first: Session;

  it('a new guarded context makes exactly one provider request, parsed into a live_guarded decision with accounting', async () => {
    const before = await fakeCalls();
    const s0 = (await createHumanSession(input('a'))).value;
    first = (await recommend(s0)).value;
    const p = first.pending!;
    expect(p.provenance.recommendation_execution_mode).toBe('live_guarded');
    expect(p.provider_costs).toMatchObject({ reservations: 1, live_calls: 1, cache_reuse: false });
    const after = p.provider_costs.journal_after!;
    expect(after.reservations).toBe(p.provider_costs.journal_before!.reservations + 1);
    const record = after.records.find((r) => r.key === p.source_decision_fingerprint);
    expect(record?.usage?.total_tokens).toBe(p.provider_costs.new_tokens);
    expect(p.recommendation.rationale).toContain('fallback=False');
    expect(p.recommendation.constraint_violations).toEqual([]);
    expect(await fakeCalls()).toBe(before + 1);
  });

  it('an identical second session reuses the journaled decision: no request, live provenance kept', async () => {
    const before = await fakeCalls();
    const s = (await recommend((await createHumanSession(input('a'))).value)).value;
    const p = s.pending!;
    expect(p.source_decision_fingerprint).toBe(first.pending!.source_decision_fingerprint);
    expect(p.recommendation.ranked_recipe_ids).toEqual(first.pending!.recommendation.ranked_recipe_ids);
    expect(p.provenance.recommendation_execution_mode).toBe('live_guarded');
    expect(p.provider_costs).toMatchObject({ reservations: 0, live_calls: 0, new_tokens: 0, cache_reuse: true });
    expect(await fakeCalls()).toBe(before);
  });

  it('a deterministic policy on the live backend never reaches the provider', async () => {
    const before = await fakeCalls();
    const s = (await recommend((await createHumanSession(input('det', { policy: 'deterministic_recipe_recommendation' }))).value)).value;
    expect(s.pending!.provenance.recommendation_execution_mode).toBe('deterministic');
    expect(s.pending!.provider_costs).toMatchObject({ live_calls: 0, reservations: 0 });
    expect(s.pending!.provider_costs.journal_after).toBeUndefined();
    expect(await fakeCalls()).toBe(before);
  });

  it('an invalid provider answer is recorded as a fallback, never retried; provenance stays live_guarded', async () => {
    const before = await fakeCalls();
    const s = (await recommend((await createHumanSession(input('invalid', { request: 'Recommend a safe recipe. fake-provider-invalid' }))).value)).value;
    const p = s.pending!;
    expect(p.provenance.recommendation_execution_mode).toBe('live_guarded');
    expect(p.recommendation.rationale).toContain('fallback=True');
    expect(p.provider_costs).toMatchObject({ live_calls: 1, cache_reuse: false });
    expect(await fakeCalls()).toBe(before + 1);
  });

  it('a synthetic guarded session: a recorded context answers without a request; otherwise exactly one live request', async () => {
    const before = await fakeCalls();
    const preset = SYNTHETIC_PRESETS[0]!;
    const s0 = (await createSyntheticSession({ policy: GUARDED, prediction_backend: preset.backend, predictor: 'population', fixture: preset.fixture })).value;
    const p = (await recommend(s0)).value.pending!;
    const mode = p.provenance.recommendation_execution_mode;
    expect(['recorded_guarded', 'live_guarded']).toContain(mode);
    const expected = mode === 'recorded_guarded' ? 0 : 1;
    expect(p.provider_costs.live_calls).toBe(expected);
    expect(await fakeCalls()).toBe(before + expected);
    console.log(`synthetic guarded turn 1 in live mode: ${mode}`);
  });

  it('a deterministic-pair branch comparison on the live backend makes no provider request', async () => {
    const before = await fakeCalls();
    const root = (await recommend((await createHumanSession(input('cmp', { policy: 'deterministic_recipe_recommendation' }))).value)).value;
    const job = (await runComparison(root, { policies: ['deterministic_recipe_recommendation', 'feedback_sequence_recipe_recommendation'], allocator: 'pcub', budget: 2, oracle: false }))
      .value;
    expect(job.provenance.recommendation_execution_mode).toBe('deterministic');
    expect(job.costs.combined).toMatchObject({ live_calls: 0 });
    expect(await fakeCalls()).toBe(before);
  });

  it('unknown completion: 409 PROVIDER_UNKNOWN_COMPLETION, terminal in the journal, recovery refused, and the decision is never sent again', async () => {
    const before = await fakeCalls();
    const s0 = (await createHumanSession(input('timeout', { request: 'Recommend a safe recipe. fake-provider-timeout' }))).value;
    const err = await failure(recommend(s0));
    expect(err.status).toBe(409);
    expect(err.code).toBe('PROVIDER_UNKNOWN_COMPLETION');
    const entry = journal.list().find((e) => e.command === 'recommend' && e.errorCode === 'PROVIDER_UNKNOWN_COMPLETION');
    expect(entry?.state).toBe('terminal');
    await expect(recoverCommand(entry!.key, sessionSchema)).rejects.toThrow(/never be retried/);
    expect(await fakeCalls()).toBe(before + 1);

    // A deliberate new command for the same context is refused by the backend without any transport.
    const again = await failure(recommend(await getSession(s0.id)));
    expect(again.code).toBe('PROVIDER_UNKNOWN_COMPLETION');
    expect(await fakeCalls()).toBe(before + 1);
    expect((await getSession(s0.id)).revision).toBe(0);
  });

  it('the live-call limit: once every reservation is used, a new context is refused before any request', async () => {
    let refused: ApiError | null = null;
    for (let i = 0; i <= limit && !refused; i++) {
      const before = await fakeCalls();
      const s0 = (await createHumanSession(input(`budget-${i}`))).value;
      try {
        const s = (await recommend(s0)).value;
        expect(s.pending!.provider_costs.live_calls).toBe(1);
        expect(await fakeCalls()).toBe(before + 1);
        expect(s.pending!.provider_costs.journal_after!.reservations).toBeLessThanOrEqual(limit);
      } catch (e) {
        refused = e as ApiError;
        expect(await fakeCalls()).toBe(before);
        expect((await getSession(s0.id)).revision).toBe(0);
      }
    }
    expect(refused?.code).toBe('PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE');
    expect(journal.list().find((e) => e.errorCode === 'PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE')?.state).toBe('rejected');
  });
});
