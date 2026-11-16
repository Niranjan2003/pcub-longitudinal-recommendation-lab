import { useRef, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NODE_BY_ID } from './systemModel';
import { SystemMap } from './SystemMap';
import { LifecycleView } from './LifecycleView';
import { CounterfactualView } from './CounterfactualView';
import { EvaluationMap } from './EvaluationMap';

const VIEWS = [
  { id: 'system', label: 'System map', sub: 'Conceptual architecture: roles, modules, stores, assets' },
  { id: 'lifecycle', label: 'Longitudinal lifecycle', sub: 'A concrete turn, step by step, and the loop' },
  { id: 'counterfactual', label: 'Counterfactual evaluation', sub: 'Hypothetical forest, allocation, estimates, oracle' },
  { id: 'evaluation', label: 'Evaluation map', sub: 'Implemented evidence and where it applies' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

export function ArchitecturePage() {
  const [params, setParams] = useSearchParams();
  const view: ViewId = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'system') as ViewId;
  const nodeParam = params.get('node');
  const node = nodeParam && NODE_BY_ID.has(nodeParam) ? nodeParam : null;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (v: ViewId) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    if (v !== 'system') next.delete('node');
    setParams(next, { replace: true });
  };
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    next.set('view', 'system');
    if (id) next.set('node', id);
    else next.delete('node');
    setParams(next, { replace: true });
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = VIEWS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    go(VIEWS[to]!.id);
    tabRefs.current[to]?.focus();
  };

  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="space-y-6">
      <header className="max-w-4xl">
        <p className="mono text-xs uppercase tracking-widest text-teal">Architecture explorer</p>
        <h1 className="mt-1 text-3xl">How the longitudinal recommendation testbed is built</h1>
        <p className="mt-2 text-muted">
          An interactive map of the implemented system. The five “agents” are <strong>functional roles</strong>: the runtime realises them with deterministic
          or statistical modules. The only optional language-model component is the guarded scorer policy. For formulas and the full limitations list, see{' '}
          <Link to="/method" className="text-teal underline">
            Method
          </Link>
          .
        </p>
      </header>

      <div role="tablist" aria-label="Architecture views" className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls={`panel-${v.id}`}
            tabIndex={view === v.id ? 0 : -1}
            onClick={() => go(v.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`border-2 px-3 py-2 text-left ${view === v.id ? 'border-ink bg-[#fffdf6]' : 'border-rule bg-card hover:border-rule-strong'}`}
          >
            <span className="mono mr-1.5 text-xs text-muted">0{i + 1}</span>
            <span className="font-serif text-lg font-semibold">{v.label}</span>
            <span className="block text-xs text-muted">{v.sub}</span>
          </button>
        ))}
      </div>

      <section role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} tabIndex={0} className="outline-none">
        {view === 'system' && <SystemMap selected={node} onSelect={select} />}
        {view === 'lifecycle' && <LifecycleView />}
        {view === 'counterfactual' && <CounterfactualView />}
        {view === 'evaluation' && <EvaluationMap />}
      </section>
    </div>
  );
}
