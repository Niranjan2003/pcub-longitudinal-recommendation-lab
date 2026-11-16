import { describe, expect, it } from 'vitest';
import { catalogRating, catalogText, reactionText, readRationale } from '@/domain/display';

describe('display-only helpers', () => {
  it('reads the guarded rationale without inventing anything', () => {
    const r = readRationale(
      'guarded_llm_score_vector@1 decision_sha256=cb79ce4f6d2493831c2ddb9fc17966c280ee80c6cd7c6ae940a1f21d76fb841b fallback=False; explanation has no outcome/state authority',
    );
    expect(r).toEqual({ kind: 'guarded', decision: 'cb79ce4f6d2493831c2ddb9fc17966c280ee80c6cd7c6ae940a1f21d76fb841b', fallback: false });
    expect(readRationale('guarded_llm_score_vector@1 decision_sha256=' + 'a'.repeat(64) + ' fallback=True; x')).toMatchObject({ fallback: true });
  });

  it('reads feedback-sequence contributions as returned (no -0)', () => {
    const r = readRationale(
      "CESRec-inspired signed pseudo-interaction history; interpretable contributions: {'health': 1.0, 'taste': 0.0, 'effort': -0.38333333333333336, 'pseudo_interaction_history': 0.0, 'repetition': -0.0}",
    );
    expect(r.kind).toBe('contributions');
    if (r.kind !== 'contributions') return;
    expect(r.parts.map((p) => [p.key, p.value])).toEqual([
      ['health', 1],
      ['taste', 0],
      ['effort', -0.38333333333333336],
      ['pseudo_interaction_history', 0],
      ['repetition', 0],
    ]);
    expect(Object.is(r.parts[4]!.value, -0)).toBe(false);
  });

  it('leaves plain-sentence rationales as written', () => {
    expect(readRationale('Selected Farfalle as the top hard-constraint-compliant candidate. Score=0.83.')).toEqual({ kind: 'text' });
  });

  it('repairs only known entity and mojibake sequences', () => {
    expect(catalogText('steam radish &amp; bean curd')).toBe('steam radish & bean curd');
    expect(catalogText('you’ll love these')).toBe('you’ll love these');
    expect(catalogText('youâ€™ll love these')).toBe('you’ll love these');
    expect(catalogText('warm water 100Â°, to 110Â°,')).toBe('warm water 100°, to 110°,');
    expect(catalogText('Potage Crémeux De Châtaigne')).toBe('Potage Crémeux De Châtaigne');
    expect(catalogText('M&m Cookies')).toBe('M&m Cookies');
  });

  it('never shows a missing catalog rating as a zero rating', () => {
    expect(catalogRating(0, 0)).toBe('no ratings in the catalog');
    expect(catalogRating(4, 1)).toBe('4 (1 rating)');
    expect(catalogRating(4.25, 4)).toBe('4.25 (4 ratings)');
    expect(catalogRating(null, null)).toBeNull();
  });

  it('labels reactions and keeps unknown values verbatim', () => {
    expect(reactionText('MODIFY_CLARIFY')).toBe('Modify / clarify');
    expect(reactionText('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('incomplete catalog ingredient lines (presentation only)', () => {
  it('flags stripped-quantity and unit-only lines, and nothing else', async () => {
    const { malformedIngredient } = await import('@/domain/display');
    expect(malformedIngredient('of fresh mint, chopped')).toBe(true);
    expect(malformedIngredient('cloves')).toBe(true);
    expect(malformedIngredient('each')).toBe(true);
    expect(malformedIngredient('medium onion')).toBe(false);
    expect(malformedIngredient('fresh cilantro, finely chopped')).toBe(false);
    expect(malformedIngredient('orange juice')).toBe(false);
  });
});
