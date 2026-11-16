import { describe, expect, it } from 'vitest';
import { buildCompare, buildCreateHumanSession, buildEndSession, buildHumanFeedback, buildRecommend } from '@/api/requests';

const persona = {
  user_id: 'u1',
  display_name: 'U One',
  dietary_pattern: 'omnivore' as const,
  allergies: ['peanut'],
  excluded_ingredients: [],
  health_goals: [],
  taste_preferences: [],
};

const base = {
  policy: 'deterministic_recipe_recommendation',
  prediction_backend: 'current_structured_simulator@1',
  predictor: 'population',
  persona,
  request: 'Recommend a safe recipe.',
  segments: 2,
  turns_per_segment: 6,
};

describe('request builders (canonical bodies)', () => {
  it('create: omits undefined optional fields; never emits fixture or baseline_traits', () => {
    const body = buildCreateHumanSession({ ...base, persona: { ...persona, max_total_time_minutes: undefined } });
    const json = JSON.stringify(body);
    expect(json).not.toContain('undefined');
    expect(json).not.toContain('max_total_time_minutes');
    expect(json).not.toContain('fixture');
    expect(json).not.toContain('baseline_traits');
    expect(body.world_kind).toBe('human_interaction');
  });

  it('create: enforces documented bounds (segments 1–4, turns 1–12, request 1–600)', () => {
    expect(() => buildCreateHumanSession({ ...base, segments: 5 })).toThrow();
    expect(() => buildCreateHumanSession({ ...base, turns_per_segment: 13 })).toThrow();
    expect(() => buildCreateHumanSession({ ...base, request: 'x'.repeat(601) })).toThrow();
    expect(() => buildCreateHumanSession({ ...base, request: '' })).toThrow();
  });

  it('create: rejects initial state outside [0,1]', () => {
    expect(() =>
      buildCreateHumanSession({
        ...base,
        initial_state: { trust: 1.2, motivation: 0.5, fatigue: 0.5, satisfaction: 0.5, engagement: 0.5, resistance: 0.5 },
      }),
    ).toThrow();
  });

  it('recommend: only expected_revision', () => {
    expect(buildRecommend(3)).toEqual({ expected_revision: 3 });
    expect(() => buildRecommend(-1)).toThrow();
    expect(() => buildRecommend(1.5)).toThrow();
  });

  it('feedback: structured; a requested change needs instruction or residual text', () => {
    const ok = buildHumanFeedback({
      expectedRevision: 1,
      recommendationId: 's:s01:t01',
      reaction: 'MODIFY_CLARIFY',
      continuation: 'CONTINUE',
      requestedChanges: [{ dimensions: ['effort'], instruction: 'quicker' }],
    });
    expect(ok.operation).toBe('feedback');
    expect(ok.requested_changes[0]).toEqual({ dimensions: ['effort'], instruction: 'quicker' });
    expect(() =>
      buildHumanFeedback({
        expectedRevision: 1,
        recommendationId: 'x',
        reaction: 'ACCEPT',
        continuation: 'CONTINUE',
        requestedChanges: [{ dimensions: ['effort'] }],
      }),
    ).toThrow();
  });

  it('end session: cancel/close carry no reaction or changes', () => {
    const b = buildEndSession({ expectedRevision: 2, operation: 'close' });
    expect(Object.keys(b).sort()).toEqual(['expected_revision', 'operation']);
    const c = buildEndSession({ expectedRevision: 2, operation: 'cancel', recommendationId: 'pid' });
    expect(c).toEqual({ expected_revision: 2, operation: 'cancel', recommendation_id: 'pid' });
  });

  it('compare: a human oracle can never be requested; pair must be distinct; budget from the allowed set', () => {
    const input = {
      session_id: 's',
      expected_revision: 1,
      policies: ['deterministic_recipe_recommendation', 'feedback_sequence_recipe_recommendation'] as [string, string],
      allocator: 'pcub' as const,
      budget: 8 as const,
      oracle: false,
    };
    expect(buildCompare(input, 'human_interaction')).toEqual(input);
    expect(() => buildCompare({ ...input, oracle: true }, 'human_interaction')).toThrow(/human oracle/i);
    expect(buildCompare({ ...input, oracle: true }, 'synthetic_simulation').oracle).toBe(true);
    expect(() => buildCompare({ ...input, policies: ['a', 'a'] }, 'human_interaction')).toThrow();
    expect(() => buildCompare({ ...input, budget: 5 as 8 }, 'human_interaction')).toThrow();
  });
});
