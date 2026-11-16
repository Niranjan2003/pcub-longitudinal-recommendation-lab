import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLocalIndex, useSession } from '@/state/hooks';
import { STATE_DIMENSIONS } from '@/api/schemas';
import { formatValue, positionLabel } from '@/domain/format';
import { PREDICTOR_LABEL, policyLabel } from '@/domain/ontology';
import { ProvenanceChips, WorldBadge } from '@/components/evidence/EvidenceLabel';
import { ProbabilityBars } from '@/components/viz/ProbabilityBars';
import { ReactionTag } from '@/components/viz/ReactionMark';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { PERSISTENCE, STEPS, type Level } from './lifecycleModel';

const INK = '#1d232b';
const RULE = '#b9b3a5';
const MUTED = '#5a626c';
const TEAL = '#0f5e6b';

interface Station {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  step: number;
}

const ST: Station[] = [
  { id: 'config', x: 20, y: 60, w: 170, h: 64, lines: ['Scenario', 'configuration'], step: 0 },
  { id: 'window', x: 240, y: 60, w: 160, h: 60, lines: ['1  Candidate', 'window'], step: 1 },
  { id: 'filter', x: 430, y: 60, w: 160, h: 60, lines: ['2  Hard-constraint', 'filter'], step: 2 },
  { id: 'recommend', x: 620, y: 60, w: 160, h: 60, lines: ['3  Recommendation'], step: 3 },
  { id: 'forecast', x: 810, y: 60, w: 160, h: 60, lines: ['4  Pre-outcome', 'forecast'], step: 4 },
  { id: 'commit-forecast', x: 880, y: 200, w: 170, h: 60, lines: ['5  Forecast committed', 'before reveal'], step: 5 },
  { id: 'outcome', x: 790, y: 340, w: 180, h: 60, lines: ['6  Outcome'], step: 6 },
  { id: 'transition', x: 590, y: 340, w: 170, h: 60, lines: ['7  Atomic history +', 'state transition'], step: 7 },
  { id: 'adapt', x: 400, y: 340, w: 160, h: 60, lines: ['8  Adaptive predictor', 'update (if any)'], step: 8 },
  { id: 'closure', x: 590, y: 422, w: 170, h: 40, lines: ['12  Session closure'], step: 12 },
];

type Seg = { id: string; d: string; target: string };

const CONNECTORS: Seg[] = [
  { id: 'c0', d: 'M190 92 L240 92', target: 'config' },
  { id: 'c1', d: 'M400 90 L430 90', target: 'window' },
  { id: 'c2', d: 'M590 90 L620 90', target: 'filter' },
  { id: 'c3', d: 'M780 90 L810 90', target: 'recommend' },
  { id: 'c4', d: 'M900 120 L900 200', target: 'forecast' },
  { id: 'c5', d: 'M960 260 L960 340', target: 'commit-forecast' },
  { id: 'c6', d: 'M790 370 L760 370', target: 'outcome' },
  { id: 'c7', d: 'M590 370 L560 370', target: 'transition' },
  // The loop: next turn returns from the adaptive update to the candidate window.
  { id: 'loop', d: 'M400 370 L320 370 L320 120', target: 'loop' },
  { id: 'exit', d: 'M675 400 L675 422', target: 'closure' },
];

function isOn(target: string, stepTarget: string): boolean {
  if (stepTarget === 'all') return target !== 'config' && target !== 'closure';
  if (stepTarget === 'gate') return target === 'loop' || target === 'gate';
  return target === stepTarget;
}

function Loop({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  const cur = STEPS[step]!;
  const onKey = (e: KeyboardEvent, n: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onStep(n);
    }
  };
  return (
    <svg viewBox="0 0 1100 470" className="block h-auto w-full" role="group" aria-label="Factual turn loop">
      <defs>
        <pattern id="lc-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="#ece7dc" strokeWidth="1" />
        </pattern>
        <marker id="lc-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={RULE} />
        </marker>
        <marker id="lc-a-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={INK} />
        </marker>
      </defs>
      <rect width="1100" height="470" fill="url(#lc-grid)" />
      {/* Turn boundary: the repeated part */}
      <rect x="226" y="40" width="872" height="376" fill="none" stroke={TEAL} strokeDasharray="2 5" strokeWidth="1.5" />
      <text x="236" y="32" fontSize="11" letterSpacing="1.6" fontFamily="var(--font-mono)" fill={TEAL}>
        ONE TURN — REPEATS FOR EVERY TURN OF EVERY SEGMENT
      </text>

      {CONNECTORS.map((c) => {
        const on = isOn(c.target, cur.target);
        return <path key={c.id} d={c.d} fill="none" stroke={on ? INK : RULE} strokeWidth={on ? (c.id === 'loop' ? 3 : 2.25) : c.id === 'loop' ? 2 : 1.25} markerEnd={`url(#${on ? 'lc-a-on' : 'lc-a'})`} />;
      })}

      {/* Loop label and the segment-rollover gate on the return path */}
      <text x="250" y="300" fontSize="12" fontFamily="var(--font-sans)" fontWeight={600} fill={INK} transform="rotate(-90 250 300)">
        9 · next turn
      </text>
      <g
        role="button"
        tabIndex={0}
        aria-pressed={cur.target === 'gate'}
        aria-label="Step 10: segment rollover"
        className="cursor-pointer outline-none focus-visible:[&>polygon]:stroke-[#0f5e6b]"
        onClick={() => onStep(10)}
        onKeyDown={(e) => onKey(e, 10)}
      >
        <polygon points="320,212 352,240 320,268 288,240" fill={cur.target === 'gate' ? '#fffdf6' : '#fff'} stroke={cur.target === 'gate' ? INK : RULE} strokeWidth={cur.target === 'gate' ? 3 : 1.5} />
        <text x="362" y="236" fontSize="11.5" fontFamily="var(--font-sans)" fontWeight={600} fill={INK}>
          10 · last turn of segment?
        </text>
        <text x="362" y="252" fontSize="11" fontFamily="var(--font-sans)" fill={MUTED}>
          → turn 1 of the next segment
        </text>
      </g>

      {/* Outcome sources */}
      {[
        { y: 340, t: 'Human submits', c: '#2f5d8a' },
        { y: 372, t: 'Simulator decides', c: '#6b4fa0' },
      ].map((s) => (
        <g key={s.t}>
          <rect x="988" y={s.y} width="108" height="28" fill="#fff" stroke={s.c} strokeWidth="1.5" />
          <rect x="988" y={s.y} width="4" height="28" fill={s.c} />
          <text x="998" y={s.y + 18} fontSize="10.5" fontFamily="var(--font-sans)" fill={INK}>
            {s.t}
          </text>
          <path d={`M988 ${s.y + 14} L970 ${s.y + 14}`} fill="none" stroke={isOn('outcome', cur.target) ? INK : RULE} strokeWidth="1.5" markerEnd={`url(#${isOn('outcome', cur.target) ? 'lc-a-on' : 'lc-a'})`} />
        </g>
      ))}
      <text x="1042" y="334" fontSize="10" letterSpacing="1.2" fontFamily="var(--font-mono)" fill={MUTED} textAnchor="middle">
        ONE OF
      </text>

      {ST.map((s) => {
        const on = isOn(s.id, cur.target);
        const selected = s.step === step;
        return (
          <g
            key={s.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Step ${s.step}: ${STEPS[s.step]!.title}`}
            className="cursor-pointer outline-none"
            data-station={s.id}
            data-on={on || undefined}
            onClick={() => onStep(s.step)}
            onKeyDown={(e) => onKey(e, s.step)}
          >
            {on && <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={INK} opacity={0.12} />}
            <rect
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={2}
              fill={s.id === 'commit-forecast' ? '#fff' : on ? '#fffdf6' : '#fff'}
              stroke={on ? INK : s.id === 'config' || s.id === 'closure' ? INK : RULE}
              strokeWidth={on ? 3 : 1.25}
              strokeDasharray={s.id === 'commit-forecast' || s.id === 'forecast' ? '6 3' : undefined}
            />
            {s.lines.map((l, i) => (
              <text key={i} x={s.x + 12} y={s.y + (s.lines.length === 1 ? s.h / 2 + 5 : 25 + i * 18)} fontSize="13" fontWeight={600} fontFamily="var(--font-sans)" fill={INK}>
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

const LEVELS: { level: Level; title: string; detail: string }[] = [
  { level: 'scenario', title: 'Scenario / session', detail: 'Fixed world, policy, predictor, simulator, persona, constraints, request, plan' },
  { level: 'segment', title: 'Segment (plan: “session”)', detail: '1–4 per scenario; history and state carry across' },
  { level: 'turn', title: 'Turn', detail: 'recommendation → forecast → outcome → committed state/history' },
];

function Hierarchy({ level }: { level: Level }) {
  const active = (l: Level) => l === level;
  return (
    <div aria-label="Hierarchy" className="text-sm">
      {LEVELS.map((l, i) => (
        <div
          key={l.level}
          className={`border-2 p-3 ${active(l.level) ? 'border-ink bg-[#fffdf6]' : 'border-rule bg-card'}`}
          style={{ marginLeft: i * 18, marginTop: i === 0 ? 0 : -2 }}
          data-level={l.level}
          data-active={active(l.level) || undefined}
        >
          <p className="font-semibold">{l.title}</p>
          <p className="text-xs text-muted">{l.detail}</p>
        </div>
      ))}
      <div className="ml-[54px] mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {['recommendation', 'forecast', 'outcome', 'committed state/history', 'next turn'].map((t, i) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">→</span>}
            <span className={`border px-1.5 py-0.5 ${t === 'forecast' ? 'border-dashed border-ink' : 'border-rule'}`}>{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ on, label, children }: { on: boolean; label: string; children: ReactNode }) {
  return (
    <div className={`border-l-4 py-2 pl-3 ${on ? 'border-ink bg-[#fffdf6]' : 'border-transparent'}`} data-ground={label} data-on={on || undefined}>
      <p className="mono text-[11px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Values RETURNED by the backend for one of the user's sessions. Nothing is computed. */
function Grounding({ step }: { step: number }) {
  const index = useLocalIndex();
  const sessions = index.filter((e) => e.kind === 'session').slice().reverse();
  const [sid, setSid] = useState('');
  const q = useSession(sid || undefined);
  const s = q.data;
  const last = s ? s.evidence[s.evidence.length - 1] : undefined;
  const entry = s ? s.history[s.history.length - 1] : undefined;
  const t = STEPS[step]!.id;

  return (
    <section className="surface p-4" aria-labelledby="ground-title">
      <h3 id="ground-title" className="text-lg">
        Ground the walkthrough in one of your sessions
      </h3>
      <p className="mt-1 text-sm text-muted">
        Optional. Shows values the backend returned for the latest completed turn of a session this browser knows. Nothing here is computed.
      </p>
      {sessions.length === 0 ? (
        <p className="mt-2 text-sm">
          No sessions recorded in this browser yet.{' '}
          <Link to="/lab" className="text-teal underline">
            Create one in Live Session
          </Link>
          .
        </p>
      ) : (
        <div className="mt-2">
          <label htmlFor="ground-session" className="field-label">
            Session
          </label>
          <select id="ground-session" className="field" value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">— choose a session —</option>
            {sessions.map((e) =>
              e.kind === 'session' ? (
                <option key={e.id} value={e.id}>
                  {e.label} · {e.world_kind === 'synthetic_simulation' ? 'synthetic' : 'human'} · {policyLabel(e.policy)}
                </option>
              ) : null,
            )}
          </select>
        </div>
      )}
      {q.error && (
        <div className="mt-3">
          <ErrorPanel error={q.error} />
        </div>
      )}
      {s && !last && <p className="mt-3 text-sm text-muted">This session has no completed turn yet. Play a turn in Live Session, then come back.</p>}
      {s && last && entry && (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <WorldBadge world={s.world_kind} />
            <span className="mono text-xs text-muted">revision {s.revision}</span>
          </div>
          <Row on={['config', 'rollover', 'subsequent', 'next'].includes(t)} label="Plan and position">
            Plan {s.plan.number_of_sessions} segment(s) × {s.plan.turns_per_session} turns · latest completed turn{' '}
            <span className="mono">{positionLabel(entry.position)}</span> · {s.history.length} completed
          </Row>
          <Row on={['window', 'filter', 'recommend'].includes(t)} label="Recommendation">
            {entry.action.selected_item.title} <span className="text-muted">({policyLabel(s.policy)})</span>
          </Row>
          <Row on={['forecast', 'commit-forecast'].includes(t)} label="Forecast (made before reveal)">
            <ProbabilityBars probabilities={last.forecast.probabilities} variant="forecast" realized={last.outcome.reaction} compact />
          </Row>
          <Row on={t === 'outcome'} label="Outcome">
            <ReactionTag reaction={last.outcome.reaction} /> · {last.outcome.continuation === 'CONTINUE' ? 'Continue' : 'Disengage'}
            <div className="mt-1.5">
              <ProvenanceChips provenance={last.provenance} />
            </div>
          </Row>
          <Row on={t === 'transition'} label="Engineered state now (after the latest commit)">
            <span className="mono text-xs">{STATE_DIMENSIONS.map((d) => `${d} ${formatValue(s.state[d], 4)}`).join(' · ')}</span>
          </Row>
          <Row on={t === 'adapt'} label="Predictor">
            {PREDICTOR_LABEL[s.predictor]?.label ?? s.predictor}
            {s.predictor === 'population' ? ' — frozen; no adaptation.' : ' — adapts after each reveal within this scenario. Compare forecasts in the session’s Adaptation lens.'}
          </Row>
          <Row on={t === 'closure'} label="Status">
            {s.status === 'closed' ? 'Closed · read-only record' : 'Open'}
          </Row>
          <Link to={`/lab/sessions/${s.id}`} className="mt-2 inline-block text-sm text-teal underline">
            Open this session →
          </Link>
        </div>
      )}
    </section>
  );
}

export function LifecycleView() {
  const [step, setStep] = useState(1);
  const cur = STEPS[step]!;
  const last = STEPS.length - 1;

  return (
    <div className="space-y-5" onKeyDown={(e) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(last, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          ← Previous
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setStep((s) => Math.min(last, s + 1))} disabled={step === last}>
          Next step →
        </button>
        <button type="button" className="btn" onClick={() => setStep(0)}>
          Restart
        </button>
        <span className="mono text-sm" aria-live="polite">
          step {step} / {last}: {cur.title}
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <figure className="surface m-0 hidden p-3 md:block">
            <Loop step={step} onStep={setStep} />
            <figcaption className="mt-1 text-xs text-muted">
              Select a station, or use ← → and the buttons above. Dashed stations hold a forecast, which is not an outcome.
            </figcaption>
          </figure>
          {/* Narrow screens: ordered list of steps */}
          <ol className="m-0 list-none space-y-1 p-0 md:hidden" aria-label="Lifecycle steps">
            {STEPS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={s.n === step}
                  onClick={() => setStep(s.n)}
                  className={`w-full border px-3 py-2 text-left text-sm ${s.n === step ? 'border-2 border-ink bg-[#fffdf6]' : 'border-rule bg-card'}`}
                >
                  <span className="mono mr-2 text-xs text-muted">{s.n}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>

          <section className="surface p-5" aria-labelledby="step-title" aria-live="polite">
            <p className="mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Step {cur.n} · {cur.role}
            </p>
            <h3 id="step-title" className="mt-0.5 text-2xl">
              {cur.title}
            </h3>
            <p className="mt-2">{cur.what}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Committed / persisted</dt>
                <dd className="m-0">{cur.writes}</dd>
              </div>
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Evidence</dt>
                <dd className="m-0">{cur.evidence}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="surface p-4" aria-labelledby="hier-title">
              <h3 id="hier-title" className="text-lg">
                Where this step sits
              </h3>
              <div className="mt-3">
                <Hierarchy level={cur.level} />
              </div>
            </section>
            <section className="surface p-4" aria-labelledby="scope-title">
              <h3 id="scope-title" className="text-lg">
                Scope of longitudinal continuity
              </h3>
              <p className="mt-2 text-sm">
                The implementation demonstrates continuity <strong>within one scenario</strong>: across its turns and across its segments. A new scenario
                starts with fresh history, state and predictor adaptation. There is <strong>no learned identity or memory transferred between separate
                scenarios or sessions</strong>.
              </p>
            </section>
          </div>

          <section className="surface p-4" aria-labelledby="persist-title">
            <h3 id="persist-title" className="text-lg">
              What persists, and how far
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Persistence of each kind of state</caption>
                <thead>
                  <tr className="border-b border-rule text-xs text-muted">
                    <th className="py-1.5 pr-3 font-medium">Item</th>
                    <th className="py-1.5 pr-3 font-medium">Within a turn</th>
                    <th className="py-1.5 pr-3 font-medium">Across turns</th>
                    <th className="py-1.5 pr-3 font-medium">Across segments</th>
                    <th className="py-1.5 font-medium">Across scenarios</th>
                  </tr>
                </thead>
                <tbody>
                  {PERSISTENCE.map((r) => (
                    <tr key={r.item} className="border-b border-rule/60 align-top">
                      <th scope="row" className="py-1.5 pr-3 font-medium">
                        {r.item}
                      </th>
                      <td className="py-1.5 pr-3">{r.turn}</td>
                      <td className="py-1.5 pr-3">{r.turns}</td>
                      <td className="py-1.5 pr-3">{r.segments}</td>
                      <td className="py-1.5">{r.scenarios}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Grounding step={step} />
        </aside>
      </div>
    </div>
  );
}
