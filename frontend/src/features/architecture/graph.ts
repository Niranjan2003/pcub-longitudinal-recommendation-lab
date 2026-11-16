import type { ArchEdge } from './systemModel';

export type { ArchEdge };

/**
 * Pure navigation helpers for the System Map. These traverse the documentation
 * graph only (which component talks to which); they compute no scientific value.
 *
 * Edge direction: `from` acts on / sends to `to`.
 *   upstream(x)   = components that act on or send to x
 *   downstream(x) = components that x acts on or sends to
 */
export interface Relations {
  upstream: Set<string>;
  downstream: Set<string>;
  edges: Set<string>;
}

export function relations(edges: readonly ArchEdge[], selected: string | null, fullChain: boolean): Relations {
  const out: Relations = { upstream: new Set(), downstream: new Set(), edges: new Set() };
  if (!selected) return out;

  const walk = (dir: 'up' | 'down') => {
    const target = dir === 'up' ? out.upstream : out.downstream;
    const queue = [selected];
    const seen = new Set([selected]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        const next = dir === 'up' ? (e.to === cur ? e.from : null) : e.from === cur ? e.to : null;
        if (!next) continue;
        out.edges.add(e.id);
        if (!seen.has(next)) {
          seen.add(next);
          target.add(next);
          if (fullChain) queue.push(next);
        }
      }
    }
  };
  walk('up');
  walk('down');
  return out;
}

export interface LabelAnchor {
  x: number;
  y: number;
  rotate: boolean;
}

/**
 * Where to draw an edge label. Default: midpoint of the longest segment, horizontal.
 * 'rotate': midpoint of the longest vertical segment, drawn along it (for gutter runs).
 * [x, y]: a fixed, hand-chosen anchor. 'none': no label on the diagram.
 */
export function labelAnchor(edge: Pick<ArchEdge, 'points' | 'labelPlace'>): LabelAnchor | null {
  const place = edge.labelPlace;
  if (place === 'none') return null;
  if (Array.isArray(place)) return { x: place[0], y: place[1], rotate: false };
  const pts = edge.points;
  let best: { len: number; x: number; y: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]!;
    const [x2, y2] = pts[i]!;
    if (place === 'rotate' && x1 !== x2) continue;
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (!best || len > best.len) best = { len, x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  if (!best) return null;
  return { x: best.x, y: best.y, rotate: place === 'rotate' };
}

export function pathD(points: readonly [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}
