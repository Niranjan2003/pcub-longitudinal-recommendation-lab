import { describe, expect, it } from 'vitest';
import { capabilitiesSchema, comparisonSchema, recipeSchema, referenceResultsSchema, sessionSchema } from '@/api/schemas';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';
import session0 from '../fixtures/captured/session_rev0.json';
import session1 from '../fixtures/captured/session_rev1_pending.json';
import session2 from '../fixtures/captured/session_rev2_after_feedback.json';
import job from '../fixtures/captured/comparison_human_pcub8.json';
import r1 from '../fixtures/captured/reference_results_r1.json';

describe('response schemas accept real captured offline-backend responses', () => {
  it('capabilities', () => {
    const c = capabilitiesSchema.parse(capabilities);
    expect(c.mode).toBe('offline');
    expect(c.budgets).toEqual([2, 4, 8, 12]);
    expect(c.human_oracle).toBe(false);
  });

  it('recipe (no image: image_url is null in catalog metadata)', () => {
    const r = recipeSchema.parse(recipe);
    expect(r.recipe_id).toBe('249560');
    expect(r.image_url).toBeNull();
  });

  it('session at revision 0, 1 (pending) and 2 (after feedback)', () => {
    const s0 = sessionSchema.parse(session0);
    expect(s0.revision).toBe(0);
    expect(s0.pending).toBeNull();
    expect(s0.reference_run_fingerprint).toBeNull();

    const s1 = sessionSchema.parse(session1);
    expect(s1.revision).toBe(1);
    expect(s1.pending?.probabilities).toHaveLength(4);
    expect(s1.pending?.provenance.evidence_status).toBe('pending');
    expect(s1.pending?.provenance.reaction_origin).toBeNull();

    const s2 = sessionSchema.parse(session2);
    expect(s2.revision).toBe(2);
    expect(s2.pending).toBeNull();
    expect(s2.history).toHaveLength(1);
    expect(s2.evidence[0]?.provenance.reaction_origin).toBe('human_submission');
  });

  it('comparison job: null metrics and oracle are preserved as null (absent, not zero)', () => {
    const j = comparisonSchema.parse(job);
    expect(j.metrics).toBeNull();
    expect(j.oracle).toBeNull();
    expect(j.provenance.evidence_status).toBe('counterfactual');
    expect(j.provenance.reaction_origin).toBe('hypothetical');
    expect(j.result.nodes).toHaveLength(j.result.actual_expansions);
    expect(j.result.expansion_order).toHaveLength(8);
    expect(j.policies[0]).toEqual(['deterministic_recipe_recommendation', '1']);
  });

  it('frozen R1 reference results', () => {
    const r = referenceResultsSchema.parse(r1);
    expect(r.formal_closure_present).toBe(false);
    expect(r.world_kind).toBe('reference_replay');
    expect(Object.keys(r.tables)).toEqual(
      expect.arrayContaining(['primary_comparison', 'branch_metrics', 'longitudinal_metrics', 'llm_accounting', 'replay_record']),
    );
  });
});

describe('schema behaviour', () => {
  it('preserves unknown fields (loose objects) so nothing is silently dropped', () => {
    const withExtra = { ...(capabilities as object), future_field: { a: 1 } };
    const c = capabilitiesSchema.parse(withExtra) as Record<string, unknown>;
    expect(c.future_field).toEqual({ a: 1 });
  });

  it('rejects a response missing a required field instead of rendering partial data', () => {
    const broken: Record<string, unknown> = { ...(session1 as Record<string, unknown>) };
    delete broken.revision;
    expect(sessionSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an unknown reaction label', () => {
    const bad = structuredClone(session2) as { evidence: { outcome: { reaction: string } }[] };
    bad.evidence[0]!.outcome.reaction = 'LOVE_IT';
    expect(sessionSchema.safeParse(bad).success).toBe(false);
  });

  it('tolerates optional capability keys being absent (discrepancy D2)', () => {
    const minimal: Record<string, unknown> = { ...(capabilities as Record<string, unknown>) };
    for (const k of ['branch_depth', 'human_oracle', 'live_guarded', 'conformal', 'recorded_guarded']) delete minimal[k];
    expect(capabilitiesSchema.safeParse(minimal).success).toBe(true);
  });
});
