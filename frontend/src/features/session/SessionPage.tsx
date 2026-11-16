import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import type { Session } from '@/api/schemas';
import { GUARDED_POLICY, isLiveCapable } from '@/state/backendStatus';
import { useBackendStatus, useJournal, useSession, useStateObservations } from '@/state/hooks';
import { liveConsent, unknownCompletionEarlier, unknownCompletionThisPage, useLiveConsent } from '@/state/liveConsent';
import { localIndex } from '@/state/localIndex';
import { queryKeys } from '@/state/queryClient';
import { stateLog } from '@/state/stateLog';
import { PREDICTOR_LABEL, POLICY_LABEL } from '@/domain/ontology';
import { shortId } from '@/domain/format';
import { EvidenceLabel, WorldBadge } from '@/components/evidence/EvidenceLabel';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { RawJson } from '@/components/ui/RawJson';
import { AdaptationLens } from '@/components/session/AdaptationLens';
import { EndSessionButton } from '@/components/session/EndSession';
import { FeedbackDock } from '@/components/session/FeedbackDock';
import { LiveGuardedPanel } from '@/components/session/LiveGuardedPanel';
import { ConformalPanel, EvidencePair, ForecastPanel, ProviderCostMini } from '@/components/session/ForecastPanels';
import { RecipeCard } from '@/components/session/RecipeCard';
import { SyntheticExplainer } from '@/components/session/SyntheticExplainer';
import { Timeline } from '@/components/session/Timeline';
import { TrajectorySummary } from '@/components/session/TrajectorySummary';
import { StateSmallMultiples } from '@/components/viz/StateSmallMultiples';
import { JournalPanel } from '@/features/system/JournalPanel';
import { useSessionActions } from './useSessionActions';

type Tab = 'turn' | 'history' | 'state';

function turnHint(s: Session): { segment: number; turn: number; total: number; done: number } {
  const done = s.history.length;
  const tps = s.plan.turns_per_session;
  return { segment: Math.floor(done / tps) + 1, turn: (done % tps) + 1, total: s.plan.number_of_sessions * tps, done };
}

export function SessionPage() {
  const { sessionId } = useParams();
  const q = useSession(sessionId);
  const status = useBackendStatus();
  const qc = useQueryClient();
  const observations = useStateObservations(sessionId ?? '');
  const [tab, setTab] = useState<Tab>('turn');
  const [selected, setSelected] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const session = q.data;

  const assetFingerprint = status.kind === 'offline' || status.kind === 'live' ? status.capabilities.asset_manifest_fingerprint : undefined;
  const live = status.kind === 'live' || (status.kind === 'offline' && isLiveCapable(status.capabilities));
  // Live guarded: a recommendation can make one real provider request. Needs explicit per-session consent,
  // and stops for this page after a provider unknown completion.
  const consent = useLiveConsent(sessionId ?? '');
  const journalEntries = useJournal();
  const halted = unknownCompletionThisPage(journalEntries);
  const liveGuarded = live && session?.policy === GUARDED_POLICY;
  const liveLocked = liveGuarded && (!consent || halted);

  const actions = useSessionActions(
    session,
    assetFingerprint,
    (message) => {
      setAnnouncement(message);
      setSelected(null);
      setTab('turn');
      // Move focus to the outcome heading so keyboard and screen-reader users land on the result.
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    { liveGuarded, liveAllowed: consent && !halted },
  );

  // Record what the backend returned: local index entry + observed state.
  useEffect(() => {
    if (!session) return;
    stateLog.record(session);
    if (!localIndex.list().some((e) => e.kind === 'session' && e.id === session.id)) {
      localIndex.upsert({
        kind: 'session',
        id: session.id,
        world_kind: session.world_kind,
        policy: session.policy,
        predictor: session.predictor,
        label: session.persona.display_name,
        createdAt: new Date().toISOString(),
      });
    }
  }, [session]);

  if (!sessionId) return null;

  if (q.isPending) return <p className="text-muted">Loading session…</p>;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.code === 'NOT_FOUND';
    return (
      <div className="max-w-2xl space-y-3">
        <ErrorPanel error={q.error} title={notFound ? 'Session not found in this backend database' : undefined} />
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => void q.refetch()}>
            Try again
          </button>
          <Link to="/lab" className="btn no-underline">
            Back to Live Session
          </Link>
        </div>
      </div>
    );
  }
  if (!session) return null;

  const hint = turnHint(session);
  const closed = session.status === 'closed';
  const guarded = session.policy === GUARDED_POLICY;
  const synthetic = session.world_kind === 'synthetic_simulation';
  const pending = session.pending;
  const lastEvidence = session.evidence[session.evidence.length - 1];
  const selectedEvidence = selected !== null ? session.evidence[selected] : undefined;
  const selectedEntry = selected !== null ? session.history[selected] : undefined;
  const policyMeta = POLICY_LABEL[session.policy];
  const err = actions.error;
  const staleRevision = err instanceof ApiError && err.code === 'STALE_REVISION';
  const noSafe = err instanceof ApiError && err.code === 'NO_SAFE_RECOMMENDATION';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'turn', label: 'Turn' },
    { id: 'history', label: 'History' },
    { id: 'state', label: 'State' },
  ];
  const show = (t: Tab) => (tab === t ? 'block' : 'hidden lg:block');

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <WorldBadge world={session.world_kind} />
              <EvidenceLabel tone={closed ? 'neutral' : 'ok'}>{closed ? 'Closed · read-only record' : 'Open'}</EvidenceLabel>
            </div>
            <h1 className="mt-2 text-2xl">{session.persona.display_name}</h1>
            <p className="mt-0.5 text-sm text-muted">“{session.request}”</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Policy</dt>
              <dd className="font-medium" title={session.policy}>
                {policyMeta?.label ?? session.policy}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Predictor</dt>
              <dd className="font-medium">{PREDICTOR_LABEL[session.predictor]?.label ?? session.predictor}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Revision</dt>
              <dd className="mono">{session.revision}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Progress</dt>
              <dd className="mono" title="Display hint derived from history length and the plan; the backend decides the horizon.">
                {hint.done}/{hint.total} turns · segment {Math.min(hint.segment, session.plan.number_of_sessions)}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted">Session id · backend simulator</dt>
              <dd className="mono text-xs">
                {shortId(session.id, 13)} · {session.backend}
              </dd>
            </div>
          </dl>
        </div>
        <p className="mt-3 border-t border-rule pt-2 text-xs text-muted">{session.claim}</p>
      </header>

      {/* Small-screen tabs */}
      <div role="tablist" aria-label="Session sections" className="flex gap-1 lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className={`btn flex-1 ${tab === t.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sr-only-live" role="status" aria-live="polite">
        {announcement}
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_330px]">
        {/* Timeline */}
        <aside className={`${show('history')} lg:order-1`}>
          <div className="surface p-3">
            <Timeline session={session} selected={selected} onSelect={(i) => (setSelected(i), setTab('turn'))} />
          </div>
        </aside>

        {/* Current turn */}
        <section className={`${show('turn')} min-w-0 space-y-4 lg:order-2`} aria-label="Current turn">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl outline-none">
            {closed
              ? 'Session record'
              : pending
                ? `Turn ${pending.predictor_input.position.turn_index} · segment ${pending.predictor_input.position.session_index} — recommendation`
                : `Next: turn ${hint.turn} · segment ${hint.segment}`}
          </h2>

          {closed && session.history.length > 0 && !selectedEvidence && <TrajectorySummary session={session} />}

          {closed && (
            <p className="rounded border border-rule bg-paper-2 px-3 py-2 text-sm">
              <strong>This session is closed</strong> and is now a read-only record. Select a turn in the history for its full evidence, or{' '}
              <Link to="/lab" className="text-teal underline">
                start a new scenario
              </Link>
              .
            </p>
          )}

          {synthetic && !closed && <SyntheticExplainer session={session} collapsed={session.history.length > 0 || pending !== null} />}

          {liveGuarded && !closed && (
            <LiveGuardedPanel
              consent={consent}
              halted={halted}
              earlierUnknown={unknownCompletionEarlier(journalEntries)}
              busy={actions.busy}
              onGrant={() => liveConsent.grant(session.id)}
              onRevoke={() => liveConsent.revoke(session.id)}
            />
          )}

          {err !== null && err !== undefined && (
            <ErrorPanel error={err}>
              {staleRevision && (
                <button type="button" className="btn" onClick={() => (actions.reset(), void qc.invalidateQueries({ queryKey: queryKeys.session(session.id) }))}>
                  Reload current session
                </button>
              )}
              {noSafe && !closed && (
                <p className="text-sm">
                  You can end this session from the controls below, or start a new scenario with different constraints in{' '}
                  <Link to="/lab" className="text-teal underline">
                    Live Session
                  </Link>
                  .
                </p>
              )}
              {err instanceof ApiError && err.kind === 'uncertain' && <JournalPanel sessionId={session.id} compact />}
            </ErrorPanel>
          )}

          {/* Past turn selected from the timeline */}
          {selectedEvidence && selectedEntry && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg">Recorded turn {selectedEntry.position.turn_index}</h3>
                <button type="button" className="text-sm text-teal underline" onClick={() => setSelected(null)}>
                  Back to current
                </button>
              </div>
              <EvidencePair record={selectedEvidence} entry={selectedEntry} world={session.world_kind} />
            </div>
          )}

          {/* Pending recommendation */}
          {!selectedEvidence && pending && !closed && (
            <>
              <div className="surface-pending p-4">
                <RecipeCard pending={pending} action={pending.predictor_input.action} />
              </div>
              <ForecastPanel pending={pending} predictor={session.predictor} />
              {session.world_kind === 'human_interaction' && (
                <FeedbackDock key={pending.id} busy={actions.busy} policy={session.policy} onSubmit={(f) => actions.feedback.mutate(f)} />
              )}
              {synthetic && (
                <section className="surface-synthetic p-4" aria-label="Simulator reaction">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg">The simulator decides the reaction</h3>
                    <EvidenceLabel tone="synthetic">Synthetic · engine-owned</EvidenceLabel>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    The forecast above is already saved. The simulator now generates the reaction from private tendencies the predictor never sees.
                  </p>
                  <button type="button" className="btn btn-primary mt-3" disabled={actions.busy} onClick={() => (actions.reset(), actions.advance.mutate())}>
                    {actions.advance.isPending ? 'Simulator is reacting…' : 'Reveal the simulated reaction'}
                  </button>
                </section>
              )}
              <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
                <ConformalPanel pending={pending} />
                <ProviderCostMini pending={pending} />
              </div>
              <div className="rounded border border-rule bg-paper-2 p-3 text-sm">
                <p className="font-semibold">Explore hypothetical futures</p>
                <p className="mt-0.5 text-muted">
                  Compare two policies over modeled reaction paths from this pending recommendation. Nothing there is real, and this session is not changed.
                  {liveGuarded && ' In live mode, comparisons that include the guarded LLM are disabled; deterministic pairs make no provider request.'}
                </p>
                <Link to={`/lab/sessions/${session.id}/explore`} className="btn btn-primary mt-2 no-underline">
                  Open the branch explorer →
                </Link>
              </div>
            </>
          )}

          {/* No pending: last turn result + next action */}
          {!selectedEvidence && !pending && lastEvidence && (
            <div className="space-y-2">
              <h3 className="text-lg">
                Result of turn {session.history[session.history.length - 1]?.position.turn_index} · segment{' '}
                {session.history[session.history.length - 1]?.position.session_index}
              </h3>
              <EvidencePair record={lastEvidence} entry={session.history[session.history.length - 1]} world={session.world_kind} />
            </div>
          )}

          {!selectedEvidence && !pending && !closed && (
            <div className="surface p-5">
              {session.history.length === 0 ? (
                <>
                  <h3 className="text-lg">Ready for the first recommendation</h3>
                  <p className="mt-1 max-w-xl text-sm text-muted">
                    The policy ranks this turn’s window of 48 candidate recipes after the supported hard constraints removed incompatible ones. A reaction forecast is recorded <strong>before</strong>{' '}
                    any reaction exists, so you can later compare the forecast with what {synthetic ? 'the simulator generated' : 'you chose'}.
                  </p>
                </>
              ) : (
                <h3 className="text-lg">Continue the session</h3>
              )}
              {guarded && !live && (
                <p className="mt-2 text-sm text-muted">
                  This is the guarded-LLM policy. Offline, only 77 exact recorded contexts can be answered; for most new scenarios the backend will honestly
                  answer “recorded context unavailable”, and no other policy is substituted.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actions.busy || liveLocked}
                  onClick={() => (actions.reset(), actions.getRecommendation.mutate())}
                >
                  {actions.getRecommendation.isPending
                    ? 'Getting recommendation…'
                    : `Get recommendation for turn ${hint.turn}${liveGuarded ? ' (may send 1 live provider request)' : ''}`}
                </button>
                {synthetic && (
                  <>
                    {[1, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="btn"
                        disabled={actions.busy || liveLocked || (liveGuarded && n > 1) || session.history.length + n > hint.total}
                        onClick={() => (actions.reset(), actions.runTurns.mutate(n))}
                      >
                        Run {n} {n === 1 ? 'turn' : 'turns'} with simulator reactions
                      </button>
                    ))}
                    {hint.total - session.history.length > 3 && (
                      <button
                        type="button"
                        className="btn"
                        disabled={actions.busy || liveGuarded}
                        onClick={() => (actions.reset(), actions.runTurns.mutate(hint.total - session.history.length))}
                      >
                        Run all {hint.total - session.history.length} remaining turns
                      </button>
                    )}
                  </>
                )}
              </div>
              {synthetic && (
                <p className="mt-2 text-xs text-muted">
                  Each run step asks the policy for a recommendation, saves the forecast, then lets the simulator react. The session closes after the last planned
                  turn and then shows a trajectory summary.
                </p>
              )}
              {synthetic && liveGuarded && (
                <p className="mt-2 text-sm font-medium text-danger">
                  With live guarded scoring, multi-turn runs are off. Run one turn at a time, so each possible provider request follows its own click.
                </p>
              )}
              {liveGuarded && (actions.getRecommendation.isPending || actions.runTurns.isPending) && (
                <p className="mt-2 text-sm" role="status">
                  A live provider request can take up to a minute (the backend’s provider timeout is 60 seconds). Do not reload: the command is journaled, and
                  the backend never sends the same decision twice.
                </p>
              )}
              {actions.progress && (
                <p className="mt-2 text-sm" role="status">
                  Running turn {Math.min(actions.progress.done + 1, actions.progress.total)} of {actions.progress.total}. Each step is its own journaled command, and
                  the run stops at the first error.
                </p>
              )}
              {synthetic && session.history.length < 3 && (
                <p className="mt-2 text-xs text-muted">
                  A two-depth comparison needs the root plus two further positions in the plan; running a few turns first gives it real history to work from.
                </p>
              )}
            </div>
          )}

          {/* End session */}
          {!closed && (
            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
              <EndSessionButton hasPending={pending !== null} busy={actions.busy} onConfirm={(op) => (actions.reset(), actions.end.mutate(op))} />
              <span className="text-xs text-muted">Ending is permanent and records no reaction.</span>
            </div>
          )}

          <RawJson data={session} label="Raw session JSON (as returned)" />
        </section>

        {/* State + adaptation */}
        <aside className={`${show('state')} space-y-5 lg:order-3 lg:col-span-2 xl:col-span-1`}>
          <div className="surface p-3">
            <h3 className="text-lg">Engineered state</h3>
            <p className="mb-2 text-xs text-muted">
              Simulation variables (0–1) updated by a fixed rule after each reaction. Engineered variables, not measurements of a
              person.
            </p>
            <StateSmallMultiples observations={observations} history={session.history} plan={session.plan} />
            {session.state.recent_preferences.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-semibold">Recent requested changes</p>
                <p className="text-xs text-muted">Kept as notes in the state record; no policy reads these notes.</p>
                <ul className="list-disc pl-5">
                  {session.state.recent_preferences.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="surface p-3">
            <AdaptationLens session={session} />
          </div>
        </aside>
      </div>
    </div>
  );
}
