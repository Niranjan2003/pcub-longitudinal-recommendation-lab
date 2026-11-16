import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { journal } from '@/api/commands/journal';
import { createHumanSession, endSession, getRecipe, getSession, recommend, submitHumanFeedback } from '@/api/endpoints';
import type { Capabilities } from '@/api/schemas';
import { buildHumanFeedback, buildRecommend } from '@/api/requests';
import { newSession, personaInput, playTurn, postJson, preflight, sessionInput } from './helpers';

let caps: Capabilities;
beforeAll(async () => {
  caps = await preflight();
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe('REAL offline backend — preflight', () => {
  it('is offline with no live capability (the suite refuses to run otherwise)', () => {
    expect(caps.mode).toBe('offline');
    expect(caps.live_guarded).toBe(false);
    expect(caps.human_oracle).toBe(false);
  });
});

describe('REAL offline backend — human lifecycle', () => {
  it('create (rev 0) → recommend (rev 1, pending, forecast) → feedback (rev 2) → GET reload is identical', async () => {
    const s0 = await newSession('lifecycle');
    expect(s0.revision).toBe(0);
    expect(s0.status).toBe('open');
    expect(s0.pending).toBeNull();
    expect(s0.history).toHaveLength(0);
    expect(s0.reference_run_fingerprint).toBeNull();
    expect(s0.world_kind).toBe('human_interaction');

    const s1 = (await recommend(s0)).value;
    expect(s1.revision).toBe(1);
    expect(s1.pending).not.toBeNull();
    expect(s1.history).toHaveLength(0); // pending forecast is NOT history
    expect(s1.pending!.probabilities).toHaveLength(4);
    expect(s1.pending!.provenance.evidence_status).toBe('pending');
    expect(s1.pending!.provenance.reaction_origin).toBeNull();
    expect(s1.pending!.provider_costs.live_calls).toBe(0);
    expect(s1.pending!.recommendation.constraint_violations).toEqual([]);

    const recipe = await getRecipe(s1.pending!.recommendation.selected_recipe_id);
    expect(recipe.recipe_id).toBe(s1.pending!.recommendation.selected_recipe_id);
    expect(recipe.image_url ?? null).toBeNull();

    const s2 = (
      await submitHumanFeedback(s1, {
        recommendationId: s1.pending!.id,
        reaction: 'MODIFY_CLARIFY',
        continuation: 'CONTINUE',
        requestedChanges: [{ dimensions: ['effort'], instruction: 'Please make it quicker.' }],
      })
    ).value;
    expect(s2.revision).toBe(2);
    expect(s2.pending).toBeNull();
    expect(s2.history).toHaveLength(1);
    expect(s2.history[0]!.reaction).toBe('MODIFY_CLARIFY');
    expect(s2.evidence).toHaveLength(1);
    expect(s2.evidence[0]!.provenance.reaction_origin).toBe('human_submission');
    expect(s2.evidence[0]!.provenance.evidence_status).toBe('factual');
    // The forecast stored in evidence is the one that was pending BEFORE the reveal.
    expect(s2.evidence[0]!.forecast.probabilities).toEqual(s1.pending!.probabilities);
    expect(s2.state.recent_preferences).toContain('Please make it quicker.');

    const reloaded = await getSession(s0.id);
    expect(reloaded.revision).toBe(2);
    expect(reloaded.history).toHaveLength(1);
  });

  it('recommend is idempotent per key: replaying the identical journaled request returns the SAME revision (exactly-once)', async () => {
    const s0 = await newSession('replay');
    const body = JSON.stringify(buildRecommend(0));
    const path = `/v1/sessions/${s0.id}/recommendations`;
    const key = `it-${s0.id}-rec`;
    const a = await postJson(path, key, body);
    const b = await postJson(path, key, body);
    expect((a.body as { revision: number }).revision).toBe(1);
    expect((b.body as { revision: number }).revision).toBe(1);
    expect(b.body).toEqual(a.body);
    const now = await getSession(s0.id);
    expect(now.revision).toBe(1); // not 2: no duplicate prediction
  });

  it('feedback replay with the same key does not double-apply (one history entry, revision 2)', async () => {
    const s0 = await newSession('fbreplay');
    const s1 = (await recommend(s0)).value;
    const body = JSON.stringify(
      buildHumanFeedback({ expectedRevision: 1, recommendationId: s1.pending!.id, reaction: 'ACCEPT', continuation: 'CONTINUE', requestedChanges: [] }),
    );
    const path = `/v1/sessions/${s0.id}/feedback`;
    const key = `it-${s0.id}-fb`;
    const a = (await postJson(path, key, body)).body as { revision: number; history: unknown[] };
    const b = (await postJson(path, key, body)).body as { revision: number; history: unknown[] };
    expect(a.revision).toBe(2);
    expect(b.revision).toBe(2);
    expect(b.history).toHaveLength(1);
    expect((await getSession(s0.id)).history).toHaveLength(1);
  });

  it('the same key with a DIFFERENT body is IDEMPOTENCY_CONFLICT (409)', async () => {
    const s0 = await newSession('conflict');
    const path = `/v1/sessions/${s0.id}/recommendations`;
    const key = `it-${s0.id}-c`;
    await postJson(path, key, JSON.stringify({ expected_revision: 0 }));
    const err = await postJson(path, key, JSON.stringify({ expected_revision: 1 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('IDEMPOTENCY_CONFLICT');
    expect((err as ApiError).status).toBe(409);
  });

  it('a stale revision is rejected with STALE_REVISION and nothing changes; the journal records "rejected"', async () => {
    const s0 = await newSession('stale');
    const s1 = (await recommend(s0)).value;
    const before = journal.list().length;
    const err = await failure(recommend({ id: s0.id, revision: 0 })); // old revision
    expect(err.code).toBe('STALE_REVISION');
    expect(err.status).toBe(409);
    const last = journal.list()[journal.list().length - 1]!;
    expect(journal.list().length).toBe(before + 1);
    expect(last.state).toBe('rejected');
    expect(last.errorCode).toBe('STALE_REVISION');
    expect((await getSession(s0.id)).revision).toBe(s1.revision);
  });

  it('feedback with a mismatching recommendation id is PENDING_RECOMMENDATION_MISMATCH (409), revision unchanged', async () => {
    const s0 = await newSession('mismatch');
    const s1 = (await recommend(s0)).value;
    const err = await failure(submitHumanFeedback(s1, { recommendationId: `${s0.id}:s09:t09`, reaction: 'ACCEPT', continuation: 'CONTINUE', requestedChanges: [] }));
    expect(err.code).toBe('PENDING_RECOMMENDATION_MISMATCH');
    expect((await getSession(s0.id)).revision).toBe(1);
  });

  it('a second recommendation request at a new revision key returns the existing pending (no second prediction)', async () => {
    const s0 = await newSession('existing-pending');
    const s1 = (await recommend(s0)).value;
    // Same expected_revision=1 with a NEW key: the backend returns the existing pending action.
    const again = (await recommend(s1)).value;
    expect(again.pending!.id).toBe(s1.pending!.id);
    expect(again.pending!.probabilities).toEqual(s1.pending!.probabilities);
  });
});

describe('REAL offline backend — longitudinal continuation', () => {
  it('state and history evolve across turns; segment rollover preserves history and state', async () => {
    let s = await newSession('longitudinal', { segments: 2, turns_per_segment: 2 });
    const states = [s.state];
    const reactions = ['ACCEPT', 'REJECT', 'MODIFY_CLARIFY'] as const;
    for (const r of reactions) {
      s = await playTurn(s, r);
      states.push(s.state);
    }
    expect(s.history).toHaveLength(3);
    expect(s.history.map((h) => h.reaction)).toEqual(['ACCEPT', 'REJECT', 'MODIFY_CLARIFY']);
    // State changed after the first reveal (backend-owned rule; we only observe).
    expect(JSON.stringify(states[1])).not.toBe(JSON.stringify(states[0]));
    // Third turn is in segment 2 (rollover after 2 turns).
    expect(s.history[2]!.position.session_index).toBe(2);
    expect(s.history[2]!.position.turn_index).toBe(1);
    expect(s.status).toBe('open');
    expect(s.evidence).toHaveLength(3);
    // Each evidence forecast was stored before its reveal, in order.
    s.evidence.forEach((e, i) => expect(e.forecast.predictor_input.position).toEqual(s.history[i]!.position));
  });

  it('exhausting the horizon closes the session; later commands are rejected', async () => {
    let s = await newSession('horizon', { segments: 1, turns_per_segment: 2 });
    s = await playTurn(s);
    expect(s.status).toBe('open');
    s = await playTurn(s);
    expect(s.status).toBe('closed');
    expect(s.history).toHaveLength(2);
    const err = await failure(recommend(s));
    expect(['SESSION_CLOSED', 'HORIZON_REACHED']).toContain(err.code);
  });

  it('human DISENGAGE records the reaction and closes the session', async () => {
    let s = await newSession('disengage');
    s = await playTurn(s, 'REJECT', 'DISENGAGE');
    expect(s.status).toBe('closed');
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.continuation).toBe('DISENGAGE');
  });

  it('class_bias and population predictors work end to end', async () => {
    for (const predictor of ['class_bias', 'population'] as const) {
      let s = await newSession(`pred-${predictor}`, { predictor });
      s = await playTurn(s, 'ACCEPT');
      s = (await recommend(s)).value;
      expect(s.predictor).toBe(predictor);
      expect(s.pending!.probabilities).toHaveLength(4);
      if (predictor === 'population') {
        // Frozen population predictor: forecast equals the population vector by construction.
        expect(s.pending!.probabilities).toEqual(s.pending!.conformal_reference.population_probabilities);
      }
    }
  });

  it('every policy available offline without a provider can run a turn (deterministic, constraint-only, feedback-sequence)', async () => {
    for (const policy of ['deterministic_recipe_recommendation', 'constraint_only_baseline', 'feedback_sequence_recipe_recommendation']) {
      const s0 = await newSession(`pol-${policy.slice(0, 6)}`, { policy });
      const s1 = (await recommend(s0)).value;
      expect(s1.policy).toBe(policy);
      expect(s1.pending!.provenance.recommendation_execution_mode).toBe('deterministic');
    }
  });

  it('the agenda-derived simulator backend can host a human session', async () => {
    const s = await newSession('agenda', { prediction_backend: 'usersimcrs_agenda_derived@1' });
    expect(s.backend).toBe('usersimcrs_agenda_derived@1');
    const s1 = (await recommend(s)).value;
    expect(s1.pending).not.toBeNull();
  });
});

describe('REAL offline backend — requested changes and initial state (characterization)', () => {
  it('requested changes are accepted with any reaction (observed)', async () => {
    const s0 = await newSession('changes-accept');
    const s1 = (await recommend(s0)).value;
    const s2 = (
      await submitHumanFeedback(s1, {
        recommendationId: s1.pending!.id,
        reaction: 'ACCEPT',
        continuation: 'CONTINUE',
        requestedChanges: [{ dimensions: ['taste'], instruction: 'A bit spicier next time.' }],
      })
    ).value;
    expect(s2.history[0]!.requested_changes).toHaveLength(1);
  });

  it('a six-scalar initial_state is accepted and returned (observed)', async () => {
    const s = await newSession('init-state', {
      initial_state: { trust: 0.2, motivation: 0.9, fatigue: 0.1, satisfaction: 0.5, engagement: 0.6, resistance: 0.3 },
    });
    expect(s.state.trust).toBe(0.2);
    expect(s.state.motivation).toBe(0.9);
    expect(s.state.resistance).toBe(0.3);
  });
});

describe('REAL offline backend — ending sessions', () => {
  it('cancel while pending: closes, records the cancelled recommendation, reveals nothing, applies no state change', async () => {
    const s0 = await newSession('cancel');
    const s1 = (await recommend(s0)).value;
    const s2 = (await endSession(s1, 'cancel')).value;
    expect(s2.status).toBe('closed');
    expect(s2.pending).toBeNull();
    expect(s2.history).toHaveLength(0);
    expect(s2.evidence).toHaveLength(0);
    expect(s2.cancelled).toHaveLength(1);
    expect(s2.cancelled[0]!.id).toBe(s1.pending!.id);
    expect(s2.state).toEqual(s1.state);
  });

  it('close with no pending recommendation (no recommendation_id sent)', async () => {
    const s0 = await newSession('close');
    const s1 = (await endSession(s0, 'close')).value;
    expect(s1.status).toBe('closed');
    expect(s1.cancelled).toHaveLength(0);
    expect(s1.revision).toBe(1);
  });

  it('a closed session rejects further commands with SESSION_CLOSED', async () => {
    const s0 = await newSession('closed-reject');
    const s1 = (await endSession(s0, 'close')).value;
    const err = await failure(recommend(s1));
    expect(err.code).toBe('SESSION_CLOSED');
  });
});

describe('REAL offline backend — safety and unavailable contexts, shown faithfully', () => {
  it('impossible hard constraints → NO_SAFE_RECOMMENDATION (422); revision unchanged; constraints not relaxed', async () => {
    const s0 = await createHumanSession(
      sessionInput('nosafe', { persona: personaInput('nosafe', { max_total_time_minutes: 1, dietary_pattern: 'vegan', max_ingredient_count: 0 }) }),
    ).then((r) => r.value);
    const err = await failure(recommend(s0));
    expect(err.code).toBe('NO_SAFE_RECOMMENDATION');
    expect(err.status).toBe(422);
    const after = await getSession(s0.id);
    expect(after.revision).toBe(0);
    expect(after.pending).toBeNull();
  });

  it('guarded policy offline: new scenario context is not in the recorded closure → RECORDED_CONTEXT_UNAVAILABLE, no substitution, no provider call', async () => {
    const s0 = await newSession('guarded', { policy: 'guarded_llm_score_vector' });
    const err = await failure(recommend(s0));
    expect(err.code).toBe('RECORDED_CONTEXT_UNAVAILABLE');
    expect(err.status).toBe(409);
    const after = await getSession(s0.id);
    expect(after.revision).toBe(0);
    expect(after.pending).toBeNull();
    expect(after.policy).toBe('guarded_llm_score_vector'); // never silently switched
  });

  it('unknown policy → UNKNOWN_POLICY (422)', async () => {
    const err = await failure(createHumanSession(sessionInput('unk', { policy: 'no_such_policy' })));
    expect(err.code).toBe('UNKNOWN_POLICY');
    expect(err.status).toBe(422);
  });
});
