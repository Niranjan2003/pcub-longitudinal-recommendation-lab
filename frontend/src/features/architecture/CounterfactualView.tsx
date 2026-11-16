import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { Comparison, Reaction } from '@/api/schemas';
import { REACTION_META, REACTION_ORDER, ALLOCATOR_LABEL, policyLabel } from '@/domain/ontology';
import { formatExact, formatValue, shortId } from '@/domain/format';
import { useComparison, useLocalIndex } from '@/state/hooks';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { MetricsPanel, OraclePanel, ValueDotPlot } from '@/components/comparison/EstimatesPanel';
import { STAGES, type Stage } from './counterfactualModel';

const INK = '#1d232b';
const RULE = '#b9b3a5';
const MUTED = '#5a626c';
const BLUE = '#6f8ea3';

const ROOT = { x: 290, y: 260 };
const L1X = 480;
const L2X = 700;
const l1y = (i: number) => 80 + i * 120;
const l2y = (i: number, j: number) => l1y(i) - 42 + j * 28;

function Glyph({ r, x, y, size, fill }: { r: Reaction; x: number; y: number; size: number; fill: boolean }) {
  const m = REACTION_META[r];
  const c = { fill: fill ? m.color : '#fff', stroke: INK, strokeWidth: 1.2 } as const;
  const s = size;
  if (m.shape === 'circle') return <circle cx={x} cy={y} r={s} {...c} />;
  if (m.shape === 'diamond') return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y} ${x},${y + s + 1} ${x - s - 1},${y}`} {...c} />;
  if (m.shape === 'square') return <rect x={x - s + 1} y={y - s + 1} width={2 * s - 2} height={2 * s - 2} {...c} />;
  return <polygon points={`${x},${y - s} ${x + s + 1},${y + s - 1} ${x - s - 1},${y + s - 1}`} {...c} />;
}

type NodeState = 'faint' | 'outline' | 'prepared' | 'frontier' | 'expanded' | 'unexpanded' | 'enumerated';

function stateFor(stage: number, depth: 1 | 2, expandedOrder: number | undefined, haveJob: boolean, synthetic: boolean): NodeState {
  const id = STAGES[stage]!.id;
  if (id === 'root') return 'faint';
  if (id === 'forest') return 'outline';
  if (id === 'prepare') return 'prepared';
  if (id === 'allocator') return depth === 1 ? 'frontier' : 'prepared';
  if ((id === 'private' || id === 'oracle' || id === 'metrics') && synthetic) return 'enumerated';
  // expand / estimate / select (or synthetic stages in a human session)
  if (!haveJob) return 'outline';
  return expandedOrder !== undefined ? 'expanded' : 'unexpanded';
}

function ForestNode({ r, x, y, state, order, label, small }: { r: Reaction; x: number; y: number; state: NodeState; order?: number; label: string; small?: boolean }) {
  const rad = small ? 11 : 15;
  const ring =
    state === 'faint'
      ? { stroke: RULE, dash: '2 3', w: 1, fill: '#fff', op: 0.45 }
      : state === 'outline'
        ? { stroke: BLUE, dash: '3 3', w: 1.25, fill: '#fff', op: 1 }
        : state === 'prepared'
          ? { stroke: BLUE, dash: undefined, w: 1.25, fill: '#dfe9ef', op: 1 }
          : state === 'frontier'
            ? { stroke: INK, dash: undefined, w: 2.5, fill: '#fffdf6', op: 1 }
            : state === 'expanded'
              ? { stroke: INK, dash: undefined, w: 2.25, fill: '#fff', op: 1 }
              : state === 'unexpanded'
                ? { stroke: RULE, dash: '2 3', w: 1, fill: '#fff', op: 0.5 }
                : { stroke: INK, dash: undefined, w: 1.25, fill: '#f1f1ef', op: 1 };
  return (
    <g opacity={ring.op} data-forest-node={label} data-state={state}>
      <circle cx={x} cy={y} r={rad} fill={ring.fill} stroke={ring.stroke} strokeWidth={ring.w} strokeDasharray={ring.dash} />
      {state === 'enumerated' && <circle cx={x} cy={y} r={rad + 4} fill="none" stroke={INK} strokeWidth={1} />}
      <Glyph r={r} x={x} y={y} size={small ? 4.5 : 6} fill={state === 'expanded' || state === 'enumerated' || state === 'frontier'} />
      {small ? (
        <text x={x + rad + 7} y={y + 4} fontSize={10.5} fontFamily="var(--font-sans)" fill={INK}>
          {REACTION_META[r].short}
        </text>
      ) : (
        <text x={x} y={y - rad - 8} fontSize={12} fontWeight={600} textAnchor="middle" fontFamily="var(--font-sans)" fill={INK}>
          {REACTION_META[r].label}
        </text>
      )}
      {order !== undefined && state === 'expanded' && (
        <g>
          <rect x={x - rad - 24} y={y - 8} width={20} height={16} fill={INK} />
          <text x={x - rad - 14} y={y + 4} fontSize={10} textAnchor="middle" fontFamily="var(--font-mono)" fill="#fff">
            {order + 1}
          </text>
        </g>
      )}
    </g>
  );
}

function Forest({ stage, job, synthetic, budget }: { stage: number; job?: Comparison; synthetic: boolean; budget: number }) {
  const sid = STAGES[stage]!.id;
  const orderOf = new Map<string, number>();
  if (job) {
    for (const n of job.result.nodes) orderOf.set(n.branch_path.join('>'), job.result.expansion_order.indexOf(n.node_id));
  }
  const haveJob = !!job;
  const edgeColor = sid === 'root' ? RULE : BLUE;

  return (
    <svg viewBox="0 0 1100 530" className="block h-auto w-full" role="img" aria-label={`Hypothetical forest, stage: ${STAGES[stage]!.title}`}>
      <defs>
        <pattern id="cf-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="#cfdce5" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Factual side: solid, unchanged */}
      <text x="20" y="34" fontSize="10.5" letterSpacing="1.4" fontFamily="var(--font-mono)" fill={INK}>
        FACTUAL (SCHEMATIC)
      </text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="20" y={90 + i * 50} width="150" height="36" fill="#fff" stroke={INK} strokeWidth="1.25" />
          <rect x="20" y={90 + i * 50} width="5" height="36" fill={INK} />
          <text x="34" y={113 + i * 50} fontSize="12" fontFamily="var(--font-sans)" fill={INK}>
            Completed turn
          </text>
        </g>
      ))}
      <rect x="20" y="242" width="150" height="36" fill="#fff" stroke={INK} strokeWidth="2" strokeDasharray="6 3" />
      <text x="32" y="265" fontSize="12" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
        Pending recommendation
      </text>
      <text x="20" y="312" fontSize="11" fontFamily="var(--font-sans)" fill={MUTED}>
        History is never changed
      </text>
      <text x="20" y="328" fontSize="11" fontFamily="var(--font-sans)" fill={MUTED}>
        by a comparison.
      </text>

      {/* Hypothetical side: blueprint */}
      <rect x="200" y="14" width="886" height="506" fill="#eef3f6" />
      <rect x="200" y="14" width="886" height="506" fill="url(#cf-grid)" />
      <rect x="200" y="14" width="886" height="506" fill="none" stroke={BLUE} strokeDasharray="3 3" />
      <text x="214" y="34" fontSize="10.5" letterSpacing="1.4" fontFamily="var(--font-mono)" fill="#3d6078">
        HYPOTHETICAL · COUNTERFACTUAL — nothing here happened
      </text>
      <path d={`M170 260 L${ROOT.x - 24} 260`} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="6 3" />

      {/* Connectors */}
      {REACTION_ORDER.map((r1, i) => (
        <g key={r1}>
          <path d={`M${ROOT.x + 24} ${ROOT.y} L380 ${ROOT.y} L380 ${l1y(i)} L${L1X - 16} ${l1y(i)}`} fill="none" stroke={edgeColor} strokeWidth="1.25" />
          {REACTION_ORDER.map((r2, j) => (
            <path key={r2} d={`M${L1X + 16} ${l1y(i)} L${L1X + 110} ${l1y(i)} L${L1X + 110} ${l2y(i, j)} L${L2X - 12} ${l2y(i, j)}`} fill="none" stroke={edgeColor} strokeWidth="1" opacity={0.8} />
          ))}
        </g>
      ))}

      {/* Root */}
      <circle cx={ROOT.x} cy={ROOT.y} r={24} fill="#fffdf6" stroke={INK} strokeWidth={sid === 'root' ? 3 : 2} />
      <text x={ROOT.x} y={ROOT.y + 4} fontSize="11" textAnchor="middle" fontFamily="var(--font-mono)" fill={INK}>
        ROOT
      </text>

      {REACTION_ORDER.map((r1, i) => (
        <g key={r1}>
          <ForestNode r={r1} x={L1X} y={l1y(i)} state={stateFor(stage, 1, orderOf.get(r1), haveJob, synthetic)} order={orderOf.get(r1)} label={r1} />
          {REACTION_ORDER.map((r2, j) => (
            <ForestNode
              key={r2}
              r={r2}
              x={L2X}
              y={l2y(i, j)}
              small
              state={stateFor(stage, 2, orderOf.get(`${r1}>${r2}`), haveJob, synthetic)}
              order={orderOf.get(`${r1}>${r2}`)}
              label={`${r1}>${r2}`}
            />
          ))}
        </g>
      ))}

      {/* Right column: stage annotation */}
      <g>
        <text x="860" y="74" fontSize="10.5" letterSpacing="1.4" fontFamily="var(--font-mono)" fill="#3d6078">
          DEPTH 1 · 4 NODES
        </text>
        <text x="860" y="92" fontSize="10.5" letterSpacing="1.4" fontFamily="var(--font-mono)" fill="#3d6078">
          DEPTH 2 · 16 NODES
        </text>
        {['expand', 'estimate', 'select'].includes(sid) && (
          <g>
            <text x="860" y="140" fontSize="13" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
              Budget {job ? job.result.budget : budget} of 20
            </text>
            <text x="860" y="160" fontSize="11.5" fontFamily="var(--font-sans)" fill={MUTED}>
              {job ? `${job.result.actual_expansions} expanded (from backend)` : 'which nodes: decided by the'}
            </text>
            <text x="860" y="176" fontSize="11.5" fontFamily="var(--font-sans)" fill={MUTED}>
              {job ? 'numbers = expansion order' : 'allocator; load a comparison'}
            </text>
            {!job && (
              <text x="860" y="192" fontSize="11.5" fontFamily="var(--font-sans)" fill={MUTED}>
                to see a real one
              </text>
            )}
          </g>
        )}
        {['private', 'oracle', 'metrics'].includes(sid) && (
          <g>
            <text x="860" y="140" fontSize="13" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
              {synthetic ? 'All 20 nodes enumerated' : 'No human oracle'}
            </text>
            <text x="860" y="160" fontSize="11.5" fontFamily="var(--font-sans)" fill={MUTED}>
              {synthetic ? 'with private simulator' : 'Human sessions report the'}
            </text>
            <text x="860" y="176" fontSize="11.5" fontFamily="var(--font-sans)" fill={MUTED}>
              {synthetic ? 'probabilities (reference only)' : 'oracle as absent, not zero'}
            </text>
          </g>
        )}
        {sid === 'prepare' && (
          <text x="860" y="140" fontSize="13" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
            All 20 prepared
          </text>
        )}
        {sid === 'allocator' && (
          <text x="860" y="140" fontSize="13" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
            Frontier: 4 first reactions
          </text>
        )}
      </g>
    </svg>
  );
}

export function CounterfactualView() {
  const [stage, setStage] = useState(0);
  const [world, setWorld] = useState<'synthetic' | 'human'>('synthetic');
  const [allocator, setAllocator] = useState('pcub');
  const [budget, setBudget] = useState(8);
  const [jobId, setJobId] = useState('');
  const index = useLocalIndex();
  const jobs = index.filter((e) => e.kind === 'job').slice().reverse();
  const q = useComparison(jobId || undefined);
  const job = q.data;
  const synthetic = job ? job.provenance.world_kind === 'synthetic_simulation' : world === 'synthetic';
  const cur = STAGES[stage]!;
  const last = STAGES.length - 1;
  const disabledStage = (s: Stage) => !!s.synthetic && !synthetic;

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') setStage((s) => Math.min(last, s + 1));
    if (e.key === 'ArrowLeft') setStage((s) => Math.max(0, s - 1));
  };

  return (
    <div className="space-y-5" onKeyDown={onKey}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset className="surface border p-4" disabled={!!job}>
          <legend className="px-1 text-sm font-semibold">Explain for</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="cf-world" className="accent-teal" checked={synthetic} onChange={() => setWorld('synthetic')} />
              Synthetic session (oracle available)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="cf-world" className="accent-teal" checked={!synthetic} onChange={() => setWorld('human')} />
              Human session (no oracle)
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cf-alloc" className="field-label">
                Allocator
              </label>
              <select id="cf-alloc" className="field" value={allocator} onChange={(e) => setAllocator(e.target.value)}>
                {Object.entries(ALLOCATOR_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">{ALLOCATOR_LABEL[allocator]?.blurb}</p>
            </div>
            <div>
              <label htmlFor="cf-budget" className="field-label">
                Budget
              </label>
              <select id="cf-budget" className="field" value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
                {[2, 4, 8, 12].map((b) => (
                  <option key={b} value={b}>
                    {b} expansions
                  </option>
                ))}
              </select>
              <p className="field-hint">The schematic does not guess which nodes an allocator would pick.</p>
            </div>
          </div>
          {job && <p className="mt-2 text-xs text-muted">Settings come from the loaded comparison.</p>}
        </fieldset>

        <section className="surface p-4" aria-labelledby="cf-job">
          <h3 id="cf-job" className="text-base font-semibold">
            Overlay one of your comparisons (optional)
          </h3>
          <p className="mt-1 text-sm text-muted">Marks the nodes the backend actually expanded and shows its returned estimates, oracle and metrics.</p>
          {jobs.length === 0 ? (
            <p className="mt-2 text-sm">
              No comparisons recorded in this browser.{' '}
              <Link to="/lab" className="text-teal underline">
                Run one from a pending turn
              </Link>
              .
            </p>
          ) : (
            <div className="mt-2">
              <label htmlFor="cf-job-select" className="field-label">
                Comparison
              </label>
              <select id="cf-job-select" className="field" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">— schematic only —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label} · {shortId(j.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {q.error && (
            <div className="mt-2">
              <ErrorPanel error={q.error} />
            </div>
          )}
          {job && (
            <p className="mt-2 text-sm">
              <EvidenceLabel tone={synthetic ? 'synthetic' : 'human'}>{synthetic ? 'Synthetic session' : 'Human session'}</EvidenceLabel>{' '}
              {job.policies.map((p) => policyLabel(p[0])).join(' vs ')} · {job.result.allocator_id} · budget {job.result.budget} ·{' '}
              <Link to={`/comparisons/${job.id}`} className="text-teal underline">
                open full result
              </Link>
            </p>
          )}
        </section>
      </div>

      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Comparison stages">
        {STAGES.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              aria-current={i === stage ? 'step' : undefined}
              onClick={() => setStage(i)}
              className={`border px-2.5 py-1.5 text-left text-xs ${i === stage ? 'border-2 border-ink bg-[#fffdf6] font-semibold' : 'border-rule bg-card'} ${
                disabledStage(s) ? 'text-muted line-through decoration-1' : ''
              }`}
            >
              <span className="mono mr-1">{i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <figure className="m-0 overflow-x-auto border border-rule bg-card p-2">
        <div className="min-w-[640px]">
          <Forest stage={stage} job={job} synthetic={synthetic} budget={budget} />
        </div>
      </figure>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={`p-5 ${cur.synthetic ? 'surface-oracle' : 'surface-hypothetical'}`} aria-labelledby="cf-stage" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Stage {stage + 1} of {STAGES.length}
            </p>
            <EvidenceLabel tone={cur.synthetic ? 'oracle' : stage === 0 ? 'neutral' : 'hypothetical'}>
              {cur.synthetic ? 'Synthetic reference · not human truth' : stage === 0 ? 'Factual root' : 'Hypothetical'}
            </EvidenceLabel>
          </div>
          <h3 id="cf-stage" className="mt-1 text-2xl">
            {cur.title}
          </h3>
          <p className="mt-2">{cur.text}</p>
          {disabledStage(cur) && (
            <p className="mt-2 border-l-4 border-warn bg-warn-soft px-3 py-2 text-sm">
              Not applicable to a human session: no human oracle exists, so the backend returns the oracle and metrics as absent (null), never as zero.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" onClick={() => setStage((s) => Math.max(0, s - 1))} disabled={stage === 0}>
              ← Previous
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStage((s) => Math.min(last, s + 1))} disabled={stage === last}>
              Next stage →
            </button>
          </div>

          {/* Real values, verbatim, only when a comparison is loaded */}
          {job && stage >= 5 && (
            <div className="mt-4 space-y-3 bg-white/70 p-3">
              <p className="text-sm">
                Selected by the limited estimate: <strong>{policyLabel(job.result.selected_policy)}</strong>
              </p>
              <ValueDotPlot
                estimates={job.result.estimated_policy_values}
                selected={job.result.selected_policy}
                oracle={stage >= 8 && job.oracle && typeof job.oracle.policy_values === 'object' ? (job.oracle.policy_values as Record<string, number>) : null}
                oracleBest={stage >= 8 && job.oracle && typeof job.oracle.best_policy === 'string' ? job.oracle.best_policy : null}
              />
              <ul className="mono m-0 list-none p-0 text-xs">
                {Object.entries(job.result.estimated_policy_values).map(([p, v]) => (
                  <li key={p} title={formatExact(v)}>
                    estimate {p}: {formatValue(v, 6)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {job && stage >= 8 && (
            <div className="mt-3 space-y-3">
              <OraclePanel oracle={job.oracle} />
              {stage >= 9 && <MetricsPanel metrics={job.metrics} />}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <section className="surface p-4 text-sm" aria-labelledby="cf-boundary">
            <h3 id="cf-boundary" className="text-base font-semibold">
              Five things never to mix
            </h3>
            <ul className="mt-2 list-none space-y-2 p-0">
              <li className="border-l-4 border-ink pl-2">
                <strong>Factual history</strong> — what happened in the session. A comparison never changes it.
              </li>
              <li className="border-l-4 border-dashed border-ink pl-2">
                <strong>Forecast</strong> — the pending prediction at the root. Not an outcome.
              </li>
              <li className="border-l-4 border-[#6f8ea3] pl-2">
                <strong>Hypothetical branches</strong> — modeled paths; nothing in them happened.
              </li>
              <li className="border-l-4 border-[#6f8ea3] pl-2">
                <strong>Limited estimates</strong> — visited-mass approximations from the population predictor.
              </li>
              <li className="border-l-4 border-double border-ink pl-2">
                <strong>Simulator-relative oracle</strong> — synthetic only; a reference, never human truth.
              </li>
            </ul>
          </section>
          <p className="text-xs text-muted">
            Allocator and budget controls only change the explanation. Use the{' '}
            <Link to="/lab" className="text-teal underline">
              Live Session
            </Link>{' '}
            to run a real comparison.
          </p>
        </aside>
      </div>
    </div>
  );
}
