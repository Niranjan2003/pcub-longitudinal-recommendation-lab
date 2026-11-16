/**
 * Display formatting only. No scientific computation: these functions change
 * how a backend-supplied number is written, never its value.
 */

/** Probability as a percent. Tiny non-zero values never display as 0. */
export function formatPercent(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—';
  const pct = p * 100;
  if (p > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(digits)}%`;
}

/** Fixed-decimal for values the backend returns as floats (utilities, regret…). */
export function formatValue(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** Full-precision string for "exact value" disclosures. */
export function formatExact(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  return String(v);
}

export function shortId(id: string, head = 8): string {
  return id.length <= head + 1 ? id : `${id.slice(0, head)}…`;
}

export function shortHash(h: string, head = 8): string {
  return h.length <= head + 2 ? h : `${h.slice(0, head)}…${h.slice(-4)}`;
}

/** Counts that the backend may report as null mean "unknown", never zero. */
export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? 'unknown' : String(n);
}

export function positionLabel(p: { session_index: number; turn_index: number }): string {
  return `S${p.session_index}·T${p.turn_index}`;
}
