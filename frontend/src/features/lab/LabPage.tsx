import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createHumanSession, createSyntheticSession } from '@/api/endpoints';
import { SYNTHETIC_PRESETS } from '@/config/syntheticPresets';
import { ApiError } from '@/api/errors';
import type { CreateHumanSessionInput } from '@/api/requests';
import { STATE_DIMENSIONS, type StateDimension } from '@/api/schemas';
import { HUMAN_PRESETS, type HumanPreset } from '@/config/humanPresets';
import { POLICY_LABEL, PREDICTOR_LABEL } from '@/domain/ontology';
import { shortId } from '@/domain/format';
import { GUARDED_POLICY, isLiveCapable } from '@/state/backendStatus';
import { useBackendStatus, useLocalIndex, useSessionCacheWriter } from '@/state/hooks';
import { localIndex } from '@/state/localIndex';
import { stateLog } from '@/state/stateLog';
import { queryKeys } from '@/state/queryClient';
import { WorldBadge } from '@/components/evidence/EvidenceLabel';
import { SyntheticExplainer } from '@/components/session/SyntheticExplainer';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Notice } from '@/components/ui/Notice';
import { JournalPanel } from '@/features/system/JournalPanel';

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const DIET_OPTIONS: { value: CreateHumanSessionInput['persona']['dietary_pattern']; label: string; disabled: boolean }[] = [
  { value: 'omnivore', label: 'Omnivore (no dietary rule)', disabled: false },
  { value: 'vegetarian', label: 'Vegetarian (approximate screening)', disabled: false },
  { value: 'vegan', label: 'Vegan (approximate screening)', disabled: false },
  { value: 'pescatarian', label: 'Pescatarian (not supported)', disabled: true },
  { value: 'other', label: 'Other (not supported)', disabled: true },
];

interface FormState {
  world: 'human' | 'synthetic';
  presetId: string;
  displayName: string;
  dietary: CreateHumanSessionInput['persona']['dietary_pattern'];
  goals: string;
  tastes: string;
  maxTime: string;
  maxIngredients: string;
  request: string;
  segments: number;
  turns: number;
  policy: string;
  backend: string;
  predictor: string;
  customState: boolean;
  state: Record<StateDimension, number>;
}

const defaultState = (): Record<StateDimension, number> => ({ trust: 0.5, motivation: 0.5, fatigue: 0.5, satisfaction: 0.5, engagement: 0.5, resistance: 0.5 });

function fromPreset(p: HumanPreset, base: FormState): FormState {
  return {
    ...base,
    displayName: p.persona.display_name,
    dietary: p.persona.dietary_pattern,
    goals: p.persona.health_goals.join(', '),
    tastes: p.persona.taste_preferences.join(', '),
    maxTime: p.persona.max_total_time_minutes?.toString() ?? '',
    maxIngredients: p.persona.max_ingredient_count?.toString() ?? '',
    request: p.request,
  };
}

function Choice({
  name,
  value,
  checked,
  disabled,
  onChange,
  title,
  blurb,
  note,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  blurb?: string;
  note?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border-2 p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal ${
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
      } ${checked ? 'border-ink bg-paper-2' : 'border-rule hover:border-rule-strong'}`}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1.5 accent-teal" />
      <span>
        <span className="block font-medium">{title}</span>
        {blurb && <span className="mt-0.5 block text-xs text-muted">{blurb}</span>}
        {note && <span className="mt-1 block text-xs font-medium text-teal">{note}</span>}
      </span>
    </label>
  );
}

export function LabPage() {
  const status = useBackendStatus();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const writeSession = useSessionCacheWriter();
  const index = useLocalIndex();
  const caps = status.kind === 'offline' || status.kind === 'live' ? status.capabilities : undefined;
  const live = caps ? isLiveCapable(caps) : false;

  const [f, setF] = useState<FormState>({
    world: 'human',
    presetId: SYNTHETIC_PRESETS[0]!.id,
    displayName: '',
    dietary: 'omnivore',
    goals: '',
    tastes: '',
    maxTime: '',
    maxIngredients: '',
    request: 'Recommend a recipe for today.',
    segments: 2,
    turns: 6,
    policy: 'deterministic_recipe_recommendation',
    backend: 'current_structured_simulator@1',
    predictor: 'contextual',
    customState: false,
    state: defaultState(),
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const [openId, setOpenId] = useState('');

  const create = useMutation({
    retry: 0,
    mutationFn: () => {
      if (f.world === 'synthetic') {
        const preset = SYNTHETIC_PRESETS.find((p) => p.id === f.presetId)!;
        // Only verified fixture + its matching backend are ever sent; the fixture owns persona, state, request and horizon.
        return createSyntheticSession(
          { policy: f.policy, prediction_backend: preset.backend, predictor: f.predictor, fixture: preset.fixture },
          { assetFingerprint: caps?.asset_manifest_fingerprint },
        );
      }
      const persona: CreateHumanSessionInput['persona'] = {
        user_id: `${(f.displayName || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${crypto.randomUUID().slice(0, 8)}`,
        display_name: f.displayName.trim(),
        dietary_pattern: f.dietary,
        // Allergy and ingredient-exclusion inputs are disabled in this release: the backend's
        // keyword matcher misses multi-word entries and plural forms (docs/SCIENTIFIC_INTERPRETATION.md,
        // "Known constraint-filter defects"). Empty lists are sent.
        allergies: [],
        excluded_ingredients: [],
        health_goals: csv(f.goals),
        taste_preferences: csv(f.tastes),
        max_total_time_minutes: f.maxTime ? Number(f.maxTime) : undefined,
        max_ingredient_count: f.maxIngredients ? Number(f.maxIngredients) : undefined,
      };
      return createHumanSession(
        {
          policy: f.policy,
          prediction_backend: f.backend,
          predictor: f.predictor,
          persona,
          initial_state: f.customState ? f.state : undefined,
          request: f.request.trim(),
          segments: f.segments,
          turns_per_segment: f.turns,
        },
        { assetFingerprint: caps?.asset_manifest_fingerprint },
      );
    },
    onSuccess: (r) => {
      const s = r.value;
      writeSession(s);
      stateLog.record(s);
      qc.setQueryData(queryKeys.session(s.id), s);
      localIndex.upsert({
        kind: 'session',
        id: s.id,
        world_kind: s.world_kind,
        policy: s.policy,
        predictor: s.predictor,
        label: s.persona.display_name,
        createdAt: new Date().toISOString(),
        assetFingerprint: caps?.asset_manifest_fingerprint,
      });
      void navigate(`/lab/sessions/${s.id}`);
    },
  });

  const sessions = index.filter((e) => e.kind === 'session').slice().reverse();
  const jobs = index.filter((e) => e.kind === 'job').slice().reverse();
  const synthetic = f.world === 'synthetic';
  const ready =
    !!caps &&
    (synthetic ? SYNTHETIC_PRESETS.some((p) => p.id === f.presetId) : f.displayName.trim().length > 0 && f.request.trim().length > 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl">Live Session</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Create a scenario and step through recommendations turn by turn. Each turn saves a reaction forecast before the reaction is known. The settings below
          are fixed for the scenario’s lifetime.
        </p>
      </header>

      {!caps && <Notice tone="warn" title="Waiting for the backend">The scenario options come from the backend’s capabilities. They appear once it is reachable.</Notice>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create.mutate();
          }}
        >
          {/* World */}
          <section className="surface-human p-5" aria-labelledby="w">
            <h2 id="w" className="text-xl">
              1 · World
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Choice
                name="world"
                value="human"
                checked={!synthetic}
                onChange={() => set('world', 'human')}
                title="Human interaction"
                blurb="You describe a persona and answer each recommendation yourself: Accept, Modify / clarify, Defer or Reject."
              />
              <Choice
                name="world"
                value="synthetic"
                checked={synthetic}
                onChange={() => set('world', 'synthetic')}
                title="Synthetic simulation"
                blurb="A simulator reacts from a curated profile. Run all 12 turns in one click; branch comparisons can use the synthetic oracle."
              />
            </div>
          </section>

          {synthetic && (
            <section className="surface-synthetic p-5" aria-labelledby="sp">
              <h2 id="sp" className="text-xl">
                2 · Simulator
              </h2>
              <p className="mt-1 text-sm text-muted">
                Each simulator comes with a curated, verified profile (persona, request, starting state and a 2 × 6-turn plan). The run is a new simulation, not a
                replay of the historical R1 experiment.
              </p>
              <fieldset className="mt-3 border-0 p-0">
                <legend className="field-label">Simulator and scenario</legend>
                <div className="grid gap-2">
                  {SYNTHETIC_PRESETS.map((p) => (
                    <Choice
                      key={p.id}
                      name="synthetic-preset"
                      value={p.id}
                      checked={f.presetId === p.id}
                      onChange={() => set('presetId', p.id)}
                      title={p.title}
                      blurb={p.blurb}
                      note="Curated profile 0002 · 2 segments × 6 turns"
                    />
                  ))}
                </div>
              </fieldset>
              <details className="mt-2 text-xs text-muted">
                <summary className="cursor-pointer select-none">Exact identifiers</summary>
                <dl className="mono mt-1 space-y-1 break-all">
                  {SYNTHETIC_PRESETS.map((p) => (
                    <div key={p.id}>
                      <dt className="font-semibold">{p.backend}</dt>
                      <dd>profile {p.profileId}</dd>
                      <dd>fixture {p.fixture}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1">The API cannot list fixtures, so only these operator-verified scenarios are offered.</p>
              </details>
            </section>
          )}

          {synthetic && <SyntheticExplainer collapsed />}

          {!synthetic && (
            <>
          {/* Presets */}
          <section className="surface p-5" aria-labelledby="pr">
            <h2 id="pr" className="text-xl">
              Example personas
            </h2>
            <p className="mt-1 text-sm text-muted">Optional starting points (pseudonymous, fully editable).</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {HUMAN_PRESETS.map((p) => (
                <button key={p.id} type="button" className="btn !h-auto flex-col !items-start gap-0.5 !py-2 text-left" onClick={() => setF((s) => fromPreset(p, s))}>
                  <span className="text-sm font-semibold">{p.title}</span>
                  <span className="text-xs font-normal text-muted">{p.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Persona */}
          <section className="surface p-5" aria-labelledby="pe">
            <h2 id="pe" className="text-xl">
              2 · Persona and preferences
            </h2>
            <div className="mt-3 max-w-md">
              <label>
                <span className="field-label">Display name (pseudonym)</span>
                <input className="field" value={f.displayName} onChange={(e) => set('displayName', e.target.value)} required maxLength={60} />
              </label>
            </div>

            <div className="mt-5 border-t border-rule pt-4" role="group" aria-labelledby="pe-diet">
              <h3 id="pe-diet" className="text-base font-semibold">
                Diet and limits
              </h3>
              <p className="text-sm text-muted">Applied to each turn’s 48-recipe candidate window before ranking, and never relaxed.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="dietary" className="field-label">
                    Dietary pattern
                  </label>
                  <select id="dietary" className="field" value={f.dietary} onChange={(e) => set('dietary', e.target.value as FormState['dietary'])}>
                    {DIET_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value} disabled={d.disabled}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label>
                  <span className="field-label">Maximum total recipe time (minutes)</span>
                  <input className="field" inputMode="numeric" type="number" min={1} value={f.maxTime} onChange={(e) => set('maxTime', e.target.value)} placeholder="optional" />
                </label>
                <label>
                  <span className="field-label">Maximum ingredients</span>
                  <input className="field" inputMode="numeric" type="number" min={0} value={f.maxIngredients} onChange={(e) => set('maxIngredients', e.target.value)} placeholder="optional" />
                </label>
              </div>
              <p className="mt-3 rounded border-l-4 border-rule-strong bg-paper-2 px-3 py-2 text-sm" role="note">
                Recipe filtering uses approximate catalog-text rules and is not suitable for allergy-sensitive meal planning. Allergy and ingredient-exclusion inputs
                are not offered in this release.{' '}
                <Link to="/method" className="text-teal underline">
                  Details on the Method page
                </Link>
              </p>
              <p className="field-hint mt-1">Total time is the catalog’s preparation plus cooking time; recipes without a recorded time are excluded when a limit is set.</p>
            </div>

            <div className="mt-5 border-t border-rule pt-4" role="group" aria-labelledby="pe-soft">
              <h3 id="pe-soft" className="text-base font-semibold">
                Soft preferences
              </h3>
              <p className="text-sm text-muted">Context for ranking and forecasting. Never a filter.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="field-label">Health goals (comma-separated)</span>
                  <input className="field" value={f.goals} onChange={(e) => set('goals', e.target.value)} placeholder="low sodium" />
                  <span className="field-hint">Read by the guarded LLM and the forecast model.</span>
                </label>
                <label>
                  <span className="field-label">Taste preferences (comma-separated)</span>
                  <input className="field" value={f.tastes} onChange={(e) => set('tastes', e.target.value)} placeholder="spicy, savory" />
                  <span className="field-hint">A small ranking bonus when the word appears in a recipe’s text.</span>
                </label>
              </div>
            </div>

            <div className="mt-5 border-t border-rule pt-4" role="group" aria-labelledby="pe-req">
              <h3 id="pe-req" className="text-base font-semibold">
                Scenario request
              </h3>
              <label className="mt-2 block">
                <span className="field-label">Request (fixed for this scenario)</span>
                <input className="field" value={f.request} onChange={(e) => set('request', e.target.value)} maxLength={600} required />
                <span className="field-hint">
                  A soft instruction, not a search or a filter. It is recorded with the scenario and shown to the guarded LLM scorer; the other policies do not read it.
                </span>
              </label>
            </div>
          </section>

          {/* Horizon */}
          <section className="surface p-5" aria-labelledby="h">
            <h2 id="h" className="text-xl">
              3 · Horizon
            </h2>
            <p className="mt-1 text-sm text-muted">Segments and turns per segment. History and state carry across segments; reaching the end closes the session.</p>
            <div className="mt-3 grid max-w-md grid-cols-2 gap-4">
              <label>
                <span className="field-label">Segments (1–4)</span>
                <input className="field" type="number" min={1} max={4} value={f.segments} onChange={(e) => set('segments', Number(e.target.value))} />
              </label>
              <label>
                <span className="field-label">Turns per segment (1–12)</span>
                <input className="field" type="number" min={1} max={12} value={f.turns} onChange={(e) => set('turns', Number(e.target.value))} />
              </label>
            </div>
            <p className="field-hint">Branch comparisons need at least two further turns after the root, so very short horizons cannot be explored.</p>
          </section>

            </>
          )}

          {/* Policy / predictor / backend */}
          <section className="surface p-5" aria-labelledby="po">
            <h2 id="po" className="text-xl">
              {synthetic ? '3' : '4'} · Recommendation policy and forecast model
            </h2>
            <fieldset className="mt-3 border-0 p-0">
              <legend className="field-label">Recommendation policy</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(caps?.policies ?? []).map((p) => {
                  const guarded = p === GUARDED_POLICY;
                  return (
                    <Choice
                      key={p}
                      name="policy"
                      value={p}
                      checked={f.policy === p}
                      onChange={() => set('policy', p)}
                      title={POLICY_LABEL[p]?.label ?? p}
                      blurb={POLICY_LABEL[p]?.blurb}
                      note={
                        guarded
                          ? live
                            ? 'Live scoring available on this backend. The session asks for your permission before any provider request.'
                            : 'Offline backend: answers only its 77 recorded contexts.'
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="mt-4 border-0 p-0">
              <legend className="field-label">Reaction forecast model</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(caps?.predictors ?? []).map((p) => (
                  <Choice key={p} name="predictor" value={p} checked={f.predictor === p} onChange={() => set('predictor', p)} title={PREDICTOR_LABEL[p]?.label ?? p} blurb={PREDICTOR_LABEL[p]?.blurb} />
                ))}
              </div>
            </fieldset>
            {synthetic ? (
              <p className="mt-4 text-sm text-muted">
                Simulator <span className="mono">{SYNTHETIC_PRESETS.find((p) => p.id === f.presetId)?.backend}</span>, fixed by the scenario chosen above.
              </p>
            ) : (
            <div className="mt-4 block max-w-md">
              <label htmlFor="sim-backend" className="field-label">
                Simulator model bundle (forecasts and branch estimates)
              </label>
              <select id="sim-backend" className="field" value={f.backend} onChange={(e) => set('backend', e.target.value)}>
                {(caps?.backends ?? [f.backend]).map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <span className="field-hint">In a human session it never generates your reactions.</span>
            </div>
            )}
          </section>

          {/* Initial state */}
          {!synthetic && (
          <section className="surface p-5" aria-labelledby="is">
            <h2 id="is" className="text-xl">
              5 · Initial engineered state (optional)
            </h2>
            <p className="mt-1 text-sm text-muted">
              Six simulation variables start at 0.5 and are updated by a fixed rule after each reaction. They are engineered variables, not measurements of you.
            </p>
            <label className="mt-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.customState} onChange={(e) => set('customState', e.target.checked)} className="accent-teal" />
              Customize starting values
            </label>
            {f.customState && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {STATE_DIMENSIONS.map((d) => (
                  <label key={d}>
                    <span className="field-label capitalize">
                      {d}: <span className="mono">{f.state[d].toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={f.state[d]}
                      onChange={(e) => set('state', { ...f.state, [d]: Number(e.target.value) })}
                      className="w-full accent-teal"
                    />
                  </label>
                ))}
              </div>
            )}
          </section>
          )}

          {create.error && (
            <ErrorPanel error={create.error}>{create.error instanceof ApiError && create.error.kind === 'uncertain' && <JournalPanel compact />}</ErrorPanel>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={!ready || create.isPending}>
              {create.isPending ? 'Creating scenario…' : 'Create scenario'}
            </button>
            {!synthetic && !f.displayName.trim() && <span className="text-sm text-muted">Enter a display name to continue.</span>}
          </div>
        </form>

        {/* Sessions index */}
        <aside className="space-y-5">
          <section className="surface p-4" aria-labelledby="ks">
            <h2 id="ks" className="text-lg">
              Your sessions
            </h2>
            <p className="text-xs text-muted">The backend can’t list sessions, so this browser remembers the ones it has seen.</p>
            {sessions.length === 0 ? (
              <p className="mt-3 text-sm text-muted">None yet. Create a scenario to begin.</p>
            ) : (
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {sessions.slice(0, 12).map((s) => (
                  <li key={s.id} className="rounded-md border border-rule p-2 text-sm">
                    <Link to={`/lab/sessions/${s.id}`} className="font-medium text-teal underline">
                      {s.kind === 'session' ? s.label : s.id}
                    </Link>
                    {s.kind === 'session' && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <WorldBadge world={s.world_kind} />
                        <span className="text-xs text-muted">{POLICY_LABEL[s.policy]?.label ?? s.policy}</span>
                      </div>
                    )}
                    <div className="mono mt-0.5 text-xs text-muted">{shortId(s.id, 13)}</div>
                    {s.missing && <p className="mt-1 text-xs font-semibold text-danger">Not found in this backend database.</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {jobs.length > 0 && (
            <section className="surface p-4" aria-labelledby="kj">
              <h2 id="kj" className="text-lg">
                Your comparisons
              </h2>
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {jobs.slice(0, 8).map((j) => (
                  <li key={j.id} className="text-sm">
                    <Link to={`/comparisons/${j.id}`} className="text-teal underline">
                      {j.kind === 'job' ? j.label : j.id}
                    </Link>
                    <div className="mono text-xs text-muted">{shortId(j.id, 13)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="surface p-4" aria-labelledby="oi">
            <h2 id="oi" className="text-lg">
              Open by id
            </h2>
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = openId.trim();
                if (id) void navigate(`/lab/sessions/${encodeURIComponent(id)}`);
              }}
            >
              <label>
                <span className="field-label">Session id</span>
                <input className="field mono" value={openId} onChange={(e) => setOpenId(e.target.value)} placeholder="UUID" />
              </label>
              <button type="submit" className="btn" disabled={!openId.trim()}>
                Open session
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
