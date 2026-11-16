/**
 * Display-only helpers. They change how backend text is shown, never what is
 * stored, sent or computed: the verbatim backend value always stays available
 * next to the readable form.
 */

export type RationaleView =
  | { kind: 'guarded'; decision: string; fallback: boolean | null }
  | { kind: 'contributions'; parts: { key: string; label: string; value: number }[] }
  | { kind: 'text' };

const GUARDED = /decision_sha256=([0-9a-f]{64})(?:\s+fallback=(True|False))?/;
const CONTRIBUTIONS = /interpretable contributions:\s*\{([^}]*)\}/;
const ENTRY = /'([a-z_]+)'\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/g;

const CONTRIBUTION_LABEL: Record<string, string> = {
  health: 'Health score',
  taste: 'Taste-preference match',
  effort: 'Preparation effort (weighted by fatigue and effort requests)',
  pseudo_interaction_history: 'Similarity to earlier accepted / rejected recipes',
  repetition: 'Repetition penalty (exact same recipe only)',
};

/** Recognises the two machine-formatted rationale strings; anything else is shown as written. */
export function readRationale(rationale: string): RationaleView {
  const g = GUARDED.exec(rationale);
  if (g) return { kind: 'guarded', decision: g[1]!, fallback: g[2] === undefined ? null : g[2] === 'True' };
  const c = CONTRIBUTIONS.exec(rationale);
  if (c) {
    const parts = [...c[1]!.matchAll(ENTRY)].map((m) => ({
      key: m[1]!,
      label: CONTRIBUTION_LABEL[m[1]!] ?? m[1]!,
      value: Number(m[2]) === 0 ? 0 : Number(m[2]),
    }));
    if (parts.length > 0) return { kind: 'contributions', parts };
  }
  return { kind: 'text' };
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', deg: '°' };
// Common UTF-8-read-as-Windows-1252 sequences found in the catalog subset.
const MOJIBAKE: [RegExp, string][] = [
  [/â€™/g, '’'],
  [/â€˜/g, '‘'],
  [/â€œ/g, '“'],
  [/â€\u009d|â€”/g, '”'],
  [/â€“/g, '–'],
  [/â€”/g, '—'],
  [/â€¦/g, '…'],
  [/Â°/g, '°'],
  [/Â(?=\s)/g, ''],
];

/**
 * Catalog text as a reader expects it: HTML entities decoded and the known
 * mojibake sequences repaired. Unrecoverable replacement characters are left as
 * they are. Display only; the backend and any provider prompt are unaffected.
 */
export function catalogText(s: string): string {
  let out = s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
  for (const [re, to] of MOJIBAKE) out = out.replace(re, to);
  return out;
}

/** "4.25 (4 ratings)", "4 (1 rating)", or that the catalog has no ratings (stored as 0 with 0 ratings). */
export function catalogRating(average: number | null | undefined, count: number | null | undefined): string | null {
  if (count === 0) return 'no ratings in the catalog';
  if (average === null || average === undefined) return null;
  if (count === null || count === undefined) return String(average);
  return `${average} (${count} ${count === 1 ? 'rating' : 'ratings'})`;
}

const UNIT_ONLY = new Set([
  'cup', 'cups', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'tbsp', 'tsp', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'g', 'kg', 'ml', 'l', 'pinch', 'dash', 'can', 'cans', 'package', 'packages', 'clove', 'cloves', 'slice', 'slices', 'piece', 'pieces', 'inch',
  'quart', 'pint', 'stick', 'sticks', 'bunch', 'head', 'large', 'medium', 'small', 'whole', 'each', 'x', 'of',
]);

/**
 * Flags ingredient lines that are visibly incomplete in the catalog source
 * (a stripped quantity leaves "of fresh mint"; a line that is only a unit such
 * as "cloves"). Presentation only: the text is shown unchanged and nothing is
 * inferred or filled in.
 */
export function malformedIngredient(line: string): boolean {
  const s = line.trim().toLowerCase();
  if (!/[a-z]/.test(s)) return true;
  if (UNIT_ONLY.has(s)) return true;
  return /^(of|or|and)\s/.test(s);
}

const REACTION_TEXT: Record<string, string> = { ACCEPT: 'Accept', MODIFY_CLARIFY: 'Modify / clarify', DEFER: 'Defer', REJECT: 'Reject' };

/** Reaction enum as a label; unknown values are shown as returned. */
export function reactionText(r: string | null | undefined): string {
  if (!r) return '—';
  return REACTION_TEXT[r] ?? r;
}
