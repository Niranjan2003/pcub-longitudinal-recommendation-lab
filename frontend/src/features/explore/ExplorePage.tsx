import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runComparison } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { CompareInput } from '@/api/requests';
import { GUARDED_POLICY, isLiveCapable } from '@/state/backendStatus';
import { useBackendStatus, useSession } from '@/state/hooks';
import { localIndex } from '@/state/localIndex';
import { queryKeys } from '@/state/queryClient';
import { ALLOCATOR_LABEL, POLICY_LABEL, PREDICTOR_LABEL, policyLabel } from '@/domain/ontology';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';
import { JournalPanel } from '@/features/system/JournalPanel';

type Allocator = CompareInput['allocator'];
type Budget = CompareInput['budget'];

function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; blurb?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="border-0 p-0" disabled={disabled}>
      <legend className="field-label">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border-2 bg-white p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal ${
              value === o.value ? 'border-ink' : 'border-rule hover:border-rule-strong'
            }`}
          >
            <input type="radio" name={legend} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-teal" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              {o.blurb && <span className="block text-xs text-muted">{o.blurb}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ExplorePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useSession(sessionId);
  const status = useBackendStatus();
  const caps = status.kind === 'offline' || status.kind === 'live' ? status.capabilities : undefined;
  const live = caps ? isLiveCapable(caps) : false;
  const session = q.data;

  const [a, setA] = useState('deterministic_recipe_recommendation');
  const [b, setB] = useState('feedback_sequence_recipe_recommendation');
  const [allocator, setAllocator] = useState<Allocator>('pcub');
  const [budget, setBudget] = useState<Budget>(8);
  // Synthetic sessions default to evaluating against the exhaustive synthetic oracle.
  const [oracleWanted, setOracleWanted] = useState(true);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);

  const run = useMutation({
    retry: 0,
    mutationFn: () =>
      runComparison(
        session!,
        { policies: [a, b], allocator, budget, oracle: session!.world_kind === 'synthetic_simulation' && oracleWanted },
        { assetFingerprint: caps?.asset_manifest_fingerprint },
      ),
    onSuccess: (r) => {
      const job = r.value;
      qc.setQueryData(queryKeys.comparison(job.id), job);
      localIndex.upsert({
        kind: 'job',
        id: job.id,
        sessionId: job.session_id,
        factualRevision: job.factual_revision,
        label: `${ALLOCATOR_LABEL[allocator]?.label ?? allocator} · budget ${budget} · ${policyLabel(a)} vs ${policyLabel(b)}`,
        createdAt: new Date().toISOString(),
      });
      void navigate(`/comparisons/${job.id}`);
    },
  });

  // Local elapsed time only: the server cannot report progress.
  useEffect(() => {
    if (!run.isPending) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [run.isPending]);
  const elapsed = run.isPending ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  if (q.isPending) return <p className="text-muted">Loading session…</p>;
  if (q.error) return <ErrorPanel error={q.error} />;
  if (!session) return null;

  const pending = session.pending;
  const policies = caps?.policies ?? [];
  const human = session.world_kind === 'human_interaction';
  const guardedChosen = a === GUARDED_POLICY || b === GUARDED_POLICY;
  const distinct = a !== b;
  const blockedLive = live && guardedChosen;
  const remaining = session.plan.number_of_sessions * session.plan.turns_per_session - session.history.length;
  const err = run.error;

  if (session.status === 'closed' || !pending) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl">Branch explorer</h1>
        <Notice tone="warn" title="A comparison needs a pending recommendation as its root">
          {session.status === 'closed'
            ? 'This session is closed, so there is no pending root.'
            : 'There is no pending recommendation in this session. Get a recommendation first, then explore hypothetical futures from it.'}
        </Notice>
        <Link to={`/lab/sessions/${session.id}`} className="btn no-underline">
          ← Back to the session
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="surface-hypothetical p-5">
        <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-3 flex flex-wrap items-center gap-3 rounded bg-white/90 px-3 py-2 backdrop-blur">
          <EvidenceLabel tone="hypothetical">Hypothetical · counterfactual</EvidenceLabel>
          <p className="text-sm font-medium">Modeled paths: nothing here happens. Your session is not changed by a comparison.</p>
        </div>
        <h1 className="text-3xl">Branch explorer</h1>
        <p className="mt-1 max-w-3xl text-sm">
          Compare two recommendation policies from this session’s pending recommendation by exploring modeled reaction paths two steps deep. An allocator decides{' '}
          <strong>which hypothetical node to expand next</strong> (not which recipe to recommend) within a budget.
        </p>
        <div className="mt-3 inline-block rounded-md border-2 border-ink bg-white px-4 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Factual root (pinned)</p>
          <p className="text-sm font-medium">
            Turn {pending.predictor_input.position.turn_index} · segment {pending.predictor_input.position.session_index} — {pending.predictor_input.action.selected_item.title}
          </p>
          <p className="mono text-xs text-muted">session revision {session.revision} · {session.persona.display_name}</p>
        </div>
      </header>

      <Notice tone="info" title="Branch probabilities use the frozen population model">
        This session’s predictor is <strong>{PREDICTOR_LABEL[session.predictor]?.label ?? session.predictor}</strong>, but comparisons always use the frozen population
        predictor; the session’s own adaptation is not carried into the branches.
      </Notice>

      {remaining < 3 && (
        <Notice tone="warn" title="Horizon may be too short">
          About {Math.max(remaining - 1, 0)} turn(s) remain after this root. A two-depth comparison needs room for two more positions; the backend decides and may answer{' '}
          <code>INSUFFICIENT_HORIZON</code>.
        </Notice>
      )}

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (distinct && !blockedLive) {
            const t = Date.now();
            setStartedAt(t);
            setNow(t);
            run.mutate();
          }
        }}
      >
        <section className="surface p-5" aria-labelledby="pair">
          <h2 id="pair" className="text-xl">
            1 · Policies to compare
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {[
              ['Policy A', a, setA] as const,
              ['Policy B', b, setB] as const,
            ].map(([label, value, set]) => (
              <div key={label}>
                <label htmlFor={`sel-${label}`} className="field-label">
                  {label}
                </label>
                <select id={`sel-${label}`} className="field" value={value} onChange={(e) => set(e.target.value)}>
                  {policies.map((p) => (
                    <option key={p} value={p} disabled={p === GUARDED_POLICY && live}>
                      {POLICY_LABEL[p]?.label ?? p}
                      {p === GUARDED_POLICY ? (live ? ' (disabled in live mode: could make many provider requests)' : ' (offline: recorded contexts only)') : ''}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{POLICY_LABEL[value]?.blurb}</span>
              </div>
            ))}
          </div>
          {!distinct && <p className="field-hint mt-2 text-danger">Choose two different policies.</p>}
          {guardedChosen && !live && (
            <p className="field-hint mt-2">
              The guarded-LLM policy runs a full preparation pass. Offline, the backend can answer only exact recorded contexts, so it will most likely report{' '}
              <code>RECORDED_CONTEXT_UNAVAILABLE</code>, which is shown faithfully, with no substitute policy.
            </p>
          )}
        </section>

        <section className="surface p-5" aria-labelledby="alloc">
          <h2 id="alloc" className="text-xl">
            2 · Allocator
          </h2>
          <div className="mt-3">
            <Segmented<Allocator>
              legend="Allocation strategy"
              value={allocator}
              onChange={setAllocator}
              options={(caps?.allocators ?? ['equal', 'greedy', 'uncertainty', 'pcub']).map((id) => ({
                value: id as Allocator,
                label: ALLOCATOR_LABEL[id]?.label ?? id,
                blurb: ALLOCATOR_LABEL[id]?.blurb,
              }))}
            />
          </div>
        </section>

        <section className="surface p-5" aria-labelledby="bud">
          <h2 id="bud" className="text-xl">
            3 · Evaluation budget
          </h2>
          <div className="mt-3">
            <Segmented<Budget>
              legend="Budget (hypothetical node expansions)"
              value={budget}
              onChange={setBudget}
              options={(caps?.budgets ?? [2, 4, 8, 12]).map((n) => ({ value: n as Budget, label: `${n} expansions` }))}
            />
          </div>
          <p className="field-hint mt-2">
            The budget limits the <em>evaluation</em>. The backend first prepares the full observable 20-node forest, so total work is larger than the budget.
          </p>
        </section>

        <section className="surface-oracle p-5" aria-labelledby="orc">
          <h2 id="orc" className="text-xl">
            4 · Synthetic oracle
          </h2>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={human}
              checked={!human && oracleWanted}
              onChange={(e) => setOracleWanted(e.target.checked)}
              className="accent-teal"
            />
            <span>Evaluate against the exhaustive synthetic oracle</span>
          </label>
          <p className="field-hint mt-1">
            {human
              ? 'Unavailable: this is a human session and a human oracle does not exist. The comparison will show estimates only, with oracle metrics absent (not zero).'
              : 'Enumerates all 20 reaction nodes for both policies using the simulator’s private probabilities, and reports regret for the limited selection. A synthetic, simulator-dependent reference: not human truth, and never an input to the allocator.'}
          </p>
        </section>

        {live && (
          <Notice tone={blockedLive ? 'danger' : 'warn'} alert={blockedLive} title="Live mode: guarded-LLM comparisons are disabled">
            A comparison first runs a full preparation pass over the 20-node hypothetical forest, and the guarded LLM needs a decision for the root and for
            every node: up to 21 decisions. With a live provider, one comparison could therefore make up to 21 provider requests inside a single request that
            cannot report progress or be cancelled. This version does not send such comparisons. Pairs of deterministic policies make no provider request and
            remain available.
          </Notice>
        )}

        {err && (
          <ErrorPanel error={err}>
            {err instanceof ApiError && err.code === 'STALE_REVISION' && (
              <button type="button" className="btn" onClick={() => (run.reset(), void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) }))}>
                Reload current session
              </button>
            )}
            {err instanceof ApiError && err.kind === 'uncertain' && <JournalPanel sessionId={session.id} compact />}
          </ErrorPanel>
        )}

        <div className="surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={!distinct || blockedLive || run.isPending}>
              {run.isPending ? 'Running comparison…' : 'Run branch comparison'}
            </button>
            <Link to={`/lab/sessions/${session.id}`} className="btn no-underline">
              Back to the session
            </Link>
          </div>
          {run.isPending && (
            <div className="mt-3" role="status" aria-live="polite">
              <div className="h-1.5 w-full overflow-hidden rounded bg-paper-2" aria-hidden="true">
                <div className="h-full w-1/3 animate-pulse rounded bg-teal" />
              </div>
              <p className="mt-1.5 text-sm">
                Running for <span className="mono">{elapsed}s</span>. The backend runs this synchronously and <strong>cannot report progress</strong>; it cannot be
                cancelled from here. Leaving this page does not stop it. Your session’s factual commands are paused in this tab until it settles.
              </p>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">The comparison is stored as an immutable record; it never changes your session.</p>
        </div>
      </form>
    </div>
  );
}
