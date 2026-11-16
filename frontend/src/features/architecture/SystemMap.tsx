import { useMemo, useState, type KeyboardEvent } from 'react';
import { EDGES, GROUPS, KIND_LABEL, NODE_BY_ID, VIEWBOX, type ArchNode } from './systemModel';
import { labelAnchor, pathD, relations } from './graph';
import { NodeInspector } from './Inspector';

const INK = '#1d232b';
const RULE = '#b9b3a5';
const MUTED = '#5a626c';
const TEAL = '#0f5e6b';
const UP = '#0f5e6b';
const DOWN = '#8a5a00';

const FILL: Record<ArchNode['kind'], string> = {
  interface: '#ffffff',
  orchestration: '#f3efe6',
  role: '#ffffff',
  component: '#ffffff',
  store: '#ffffff',
  asset: '#f3ede1',
  archive: '#f3ede1',
};

const ORDER = GROUPS.flatMap((g) => g.ids);

function NodeShape({
  n,
  state,
  focused,
}: {
  n: ArchNode;
  state: 'idle' | 'selected' | 'up' | 'down' | 'dim';
  focused: boolean;
}) {
  const role = n.kind === 'role';
  const stroke = state === 'selected' ? INK : state === 'up' ? UP : state === 'down' ? DOWN : n.kind === 'asset' || n.kind === 'archive' ? '#cdbf9f' : n.kind === 'component' ? RULE : INK;
  const sw = state === 'selected' ? 3 : state === 'up' || state === 'down' ? 2.5 : n.kind === 'orchestration' ? 2 : 1.25;
  const titleSize = role || n.kind === 'orchestration' ? 15 : 14;
  const titleFont = role || n.kind === 'archive' ? 'var(--font-serif)' : 'var(--font-sans)';
  const twoCol = (n.chips?.length ?? 0) > 4;

  return (
    <g opacity={state === 'dim' ? 0.32 : 1} style={{ transition: 'opacity 150ms' }}>
      {state === 'selected' && <rect x={n.x + 5} y={n.y + 5} width={n.w} height={n.h} fill={INK} opacity={0.12} />}
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={2} fill={state === 'selected' ? '#fffdf6' : FILL[n.kind]} stroke={stroke} strokeWidth={sw} />
      {role && <line x1={n.x + 6} x2={n.x + n.w - 6} y1={n.y + 5} y2={n.y + 5} stroke={stroke} strokeWidth={1} />}
      {n.kind === 'archive' && <rect x={n.x + 4} y={n.y + 4} width={n.w - 8} height={n.h - 8} fill="none" stroke="#cdbf9f" strokeWidth={1} />}
      {(state === 'up' || state === 'down') && <rect x={n.x} y={n.y} width={5} height={n.h} fill={stroke} />}
      {focused && <rect x={n.x - 5} y={n.y - 5} width={n.w + 10} height={n.h + 10} rx={4} fill="none" stroke={TEAL} strokeWidth={3} />}
      {n.lines.map((line, i) => (
        <text key={i} x={n.x + 14} y={n.y + (role ? 30 : 22) + i * 18} fontSize={titleSize} fontWeight={600} fontFamily={titleFont} fill={INK}>
          {line}
        </text>
      ))}
      {role && (
        <text x={n.x + 14} y={n.y + n.h - 10} fontSize={9.5} letterSpacing={1.2} fontFamily="var(--font-mono)" fill={MUTED}>
          FUNCTIONAL ROLE
        </text>
      )}
      {n.kind === 'store' && (
        <text x={n.x + n.w - 12} y={n.y + 20} fontSize={10} textAnchor="end" fontFamily="var(--font-mono)" fill={MUTED}>
          STORE
        </text>
      )}
      {n.kind === 'asset' && (
        <text x={n.x + n.w - 10} y={n.y + 18} fontSize={9.5} textAnchor="end" fontFamily="var(--font-mono)" fill="#6b5a2d">
          FROZEN
        </text>
      )}
      {n.chips?.map((c, i) => {
        const col = twoCol ? i % 2 : 0;
        const row = twoCol ? Math.floor(i / 2) : i;
        const top = n.y + 22 + (n.lines.length - 1) * 18 + 22;
        return (
          <text key={c} x={n.x + 16 + col * 100} y={top + row * 17} fontSize={12} fontFamily="var(--font-sans)" fill={c.includes('◇') ? DOWN : MUTED}>
            · {c}
          </text>
        );
      })}
    </g>
  );
}

export function SystemMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [fullChain, setFullChain] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const rel = useMemo(() => relations(EDGES, selected, fullChain), [selected, fullChain]);
  const node = selected ? NODE_BY_ID.get(selected) : undefined;

  const stateOf = (id: string): 'idle' | 'selected' | 'up' | 'down' | 'dim' => {
    if (!selected) return 'idle';
    if (id === selected) return 'selected';
    if (rel.upstream.has(id)) return 'up';
    if (rel.downstream.has(id)) return 'down';
    return 'dim';
  };

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(selected === id ? null : id);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  };

  const visibleEdges = EDGES.filter((e) => e.tier === 'structure' || showAll || rel.edges.has(e.id));
  // Draw highlighted edges last so they sit on top of faint ones.
  const ordered = [...visibleEdges].sort((a, b) => Number(rel.edges.has(a.id)) - Number(rel.edges.has(b.id)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="accent-teal" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all data flows
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="accent-teal" checked={fullChain} onChange={(e) => setFullChain(e.target.checked)} />
          Highlight the full chain (not just direct neighbours)
        </label>
        <button type="button" className="btn !min-h-8 !px-3 !py-1 text-sm" onClick={() => onSelect(null)} disabled={!selected}>
          Reset selection
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {/* Wide screens: designed diagram */}
          <figure className="surface m-0 hidden p-3 lg:block" aria-labelledby="sysmap-cap">
            <svg viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} className="block h-auto w-full" role="group" aria-label="System map: select a component to inspect it">
              <defs>
                <pattern id="sysmap-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M24 0H0V24" fill="none" stroke="#ece7dc" strokeWidth="1" />
                </pattern>
                {[
                  ['arrow-faint', RULE],
                  ['arrow-hi', INK],
                  ['arrow-opt', DOWN],
                ].map(([id, color]) => (
                  <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill={color} />
                  </marker>
                ))}
              </defs>
              <rect width={VIEWBOX.w} height={VIEWBOX.h} fill="url(#sysmap-grid)" />
              {/* Caption in the one free slot of the bottom row (no connector passes here). */}
              <text x={732} y={722} fontSize={10} letterSpacing={1.4} fontFamily="var(--font-mono)" fill={MUTED}>
                BOTTOM ROW: FROZEN ASSETS,
              </text>
              <text x={732} y={738} fontSize={10} letterSpacing={1.4} fontFamily="var(--font-mono)" fill={MUTED}>
                JOURNAL AND ARCHIVE
              </text>

              {ordered.map((e) => {
                const hi = rel.edges.has(e.id);
                const color = hi ? (e.optional ? DOWN : INK) : RULE;
                const a = labelAnchor(e);
                const w = e.label.length * 6.1 + 12;
                return (
                  <g key={e.id} data-edge={e.id}>
                    <path
                      d={pathD(e.points)}
                      fill="none"
                      stroke={color}
                      strokeWidth={hi ? 2 : 1.25}
                      strokeDasharray={e.optional ? '6 4' : e.tier === 'flow' && !hi ? '3 3' : undefined}
                      markerEnd={`url(#${hi ? (e.optional ? 'arrow-opt' : 'arrow-hi') : 'arrow-faint'})`}
                    />
                    {hi && a && (
                      <g transform={a.rotate ? `rotate(-90 ${a.x} ${a.y})` : undefined}>
                        <rect x={a.x - w / 2} y={a.y - 9} width={w} height={17} fill="#faf8f3" stroke={color} strokeWidth={0.75} />
                        <text x={a.x} y={a.y + 4} fontSize={10.5} textAnchor="middle" fontFamily="var(--font-mono)" fill={color}>
                          {e.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {ORDER.map((id) => {
                const n = NODE_BY_ID.get(id)!;
                return (
                  <g
                    key={id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected === id}
                    aria-label={`${n.title} (${KIND_LABEL[n.kind]})`}
                    data-node={id}
                    data-state={stateOf(id)}
                    className="cursor-pointer outline-none"
                    onClick={() => onSelect(selected === id ? null : id)}
                    onKeyDown={(e) => onKey(e, id)}
                    onFocus={() => setFocused(id)}
                    onBlur={() => setFocused((f) => (f === id ? null : f))}
                  >
                    <NodeShape n={n} state={stateOf(id)} focused={focused === id} />
                  </g>
                );
              })}
            </svg>
            <figcaption id="sysmap-cap" className="mt-2 text-xs text-muted">
              Arrows mean “acts on or sends to”. Solid connectors show the structure; dotted data flows appear when you select a component (or tick “Show all
              data flows”). Tab moves between components; Enter selects; Escape clears.
            </figcaption>
          </figure>

          {/* Narrow screens: same components as a grouped list */}
          <nav aria-label="System components" className="space-y-4 lg:hidden">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h3 className="mono text-[11px] uppercase tracking-[0.14em] text-muted">{g.title}</h3>
                <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                  {g.ids.map((id) => {
                    const n = NODE_BY_ID.get(id)!;
                    const st = stateOf(id);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          aria-pressed={selected === id}
                          onClick={() => onSelect(selected === id ? null : id)}
                          className={`w-full border px-3 py-2 text-left text-sm ${
                            st === 'selected' ? 'border-2 border-ink bg-[#fffdf6]' : st === 'up' ? 'border-l-4 border-teal' : st === 'down' ? 'border-l-4 border-warn' : 'border-rule'
                          } ${st === 'dim' ? 'opacity-60' : ''} ${n.kind === 'asset' || n.kind === 'archive' ? 'bg-archive' : 'bg-card'}`}
                        >
                          <span className="block font-semibold">{n.title}</span>
                          <span className="mono block text-[11px] uppercase tracking-wide text-muted">{KIND_LABEL[n.kind]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>

          {/* Legend */}
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3" aria-label="Legend">
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <rect x="1" y="1" width="32" height="16" fill="#fff" stroke={INK} />
                  <line x1="4" x2="30" y1="4" y2="4" stroke={INK} />
                </svg>
              </dt>
              <dd className="m-0">Functional agent role (not an autonomous LLM)</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <rect x="1" y="1" width="32" height="16" fill="#fff" stroke={RULE} />
                </svg>
              </dt>
              <dd className="m-0">Implementation module</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <rect x="1" y="1" width="32" height="16" fill="#f3ede1" stroke="#cdbf9f" />
                </svg>
              </dt>
              <dd className="m-0">Frozen asset or historical archive (never modified)</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <rect x="1" y="1" width="32" height="16" fill="#fff" stroke={UP} strokeWidth="2" />
                  <rect x="1" y="1" width="4" height="16" fill={UP} />
                </svg>
              </dt>
              <dd className="m-0">Upstream: acts on or sends to the selection</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <rect x="1" y="1" width="32" height="16" fill="#fff" stroke={DOWN} strokeWidth="2" />
                  <rect x="1" y="1" width="4" height="16" fill={DOWN} />
                </svg>
              </dt>
              <dd className="m-0">Downstream: the selection acts on or sends to it</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <svg width="34" height="18" aria-hidden="true">
                  <line x1="1" x2="33" y1="9" y2="9" stroke={DOWN} strokeWidth="2" strokeDasharray="6 4" />
                </svg>
              </dt>
              <dd className="m-0">◇ / dashed: optional live-provider path (not used offline)</dd>
            </div>
          </dl>
        </div>

        <aside className="surface self-start p-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto" aria-live="polite" aria-label="Component inspector">
          {node ? (
            <NodeInspector node={node} onSelect={(id) => onSelect(id)} />
          ) : (
            <div className="space-y-3 text-sm">
              <h3 className="text-xl">Select a component</h3>
              <p>
                The map shows the system as it is implemented. Five <strong>functional agent roles</strong> (recommendation, behaviour prediction, user
                simulation or human feedback, longitudinal memory, counterfactual evaluation) are coordinated by the session orchestrator.
              </p>
              <p>
                These roles are realised by deterministic or statistical modules. The only optional language-model component is the guarded scorer inside the
                recommendation policies (◇), and offline it can answer only exact recorded contexts.
              </p>
              <p className="text-muted">Select any box to see what it does, what it reads and may modify, where its results persist, and what it does not claim.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
