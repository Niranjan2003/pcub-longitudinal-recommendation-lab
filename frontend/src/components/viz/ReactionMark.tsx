import type { Reaction } from '@/api/schemas';
import { REACTION_META } from '@/domain/ontology';

/**
 * A reaction is encoded redundantly: colour (Okabe–Ito), SHAPE, a text glyph
 * and (where space allows) its name. Marks carry an ink outline so colour is
 * never the only cue.
 */
export function ReactionMark({ reaction, size = 16, title }: { reaction: Reaction; size?: number; title?: string }) {
  const m = REACTION_META[reaction];
  const common = { fill: m.color, stroke: '#1d232b', strokeWidth: 1.5 } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={title ?? m.label} className="shrink-0">
      <title>{title ?? m.label}</title>
      {m.shape === 'circle' && <circle cx="8" cy="8" r="6" {...common} />}
      {m.shape === 'diamond' && <polygon points="8,1 15,8 8,15 1,8" {...common} />}
      {m.shape === 'square' && <rect x="2.5" y="2.5" width="11" height="11" {...common} />}
      {m.shape === 'triangle' && <polygon points="8,1.5 15,14 1,14" {...common} />}
    </svg>
  );
}

export function ReactionTag({ reaction, size = 14 }: { reaction: Reaction; size?: number }) {
  const m = REACTION_META[reaction];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
      <ReactionMark reaction={reaction} size={size} />
      <span aria-hidden="true">{m.glyph}</span>
      {m.label}
    </span>
  );
}
