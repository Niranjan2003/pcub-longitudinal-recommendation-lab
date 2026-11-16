import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useCapabilities } from '@/state/hooks';
import { ALLOCATOR_LABEL, POLICY_LABEL, PREDICTOR_LABEL } from '@/domain/ontology';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';

interface Box {
  title: string;
  text: string;
  who?: string;
}

const LAYERS: { name: string; note: string; boxes: Box[]; tone: string }[] = [
  {
    name: 'Frozen assets',
    note: 'Hash-verified at startup. Never modified by any request.',
    tone: 'bg-archive',
    boxes: [
      { title: 'Recipe catalog', text: '10,000-recipe food-only HUMMUS subset; no images; empty allergen label lists.' },
      { title: 'Prediction models', text: 'Two frozen bundles (one per simulator) with fixed features, coefficients and conformal thresholds.' },
      { title: 'Recorded decisions', text: '77 exact guarded-LLM scoring contexts available offline.' },
      { title: 'Historical R1 tables', text: 'Aggregates of the frozen R1 experiment, served read-only.' },
    ],
  },
  {
    name: 'Scientific modules',
    note: 'Deterministic or statistical code. One optional language-model component.',
    tone: 'bg-white',
    boxes: [
      { title: 'Hard safety gate', text: 'Removes candidates that violate declared constraints before any ranking; never relaxed.' },
      { title: 'Four policies', text: 'Deterministic, constraint-only, feedback-sequence, and a guarded LLM scorer.', who: 'Only the guarded scorer may call a language model, and only to score a safe shortlist.' },
      { title: 'Three predictors', text: 'Frozen population, class-bias and contextual adaptation. They forecast; they never decide outcomes.' },
      { title: 'Conformal diagnostics', text: 'Frozen synthetic-reference prediction sets. Diagnostic only; never prunes branches.' },
      { title: 'Two simulators', text: 'Independent outcome generators for synthetic sessions, with private tendencies the predictor never sees.' },
      { title: 'State transition', text: 'A fixed rule moves six bounded engineered variables after each revealed reaction.' },
      { title: 'Branch engine + 4 allocators', text: 'Paired two-depth hypothetical tree; allocators choose which node to expand next.' },
      { title: 'Exhaustive oracle', text: 'Synthetic sessions only: enumerates all 20 nodes with private probabilities. Never feeds the predictor or allocator.' },
    ],
  },
  {
    name: 'Application and persistence',
    note: 'The only layer allowed to commit state.',
    tone: 'bg-white',
    boxes: [
      { title: 'Sessions', text: 'Pending forecast committed before feedback; one atomic reveal, transition, history and adapter update per reaction.' },
      { title: 'Comparisons', text: 'Synchronous jobs pinned to a revision; stored as immutable records; never modify a session.' },
      { title: 'SQLite store', text: 'Revisions and idempotency keys make a repeated command return its original response.' },
      { title: 'Provider journal', text: 'Optional live mode only. Reserves before any call; an unknown completion is never retried.' },
    ],
  },
  {
    name: 'Local HTTP API',
    note: 'Nine endpoints, bound to 127.0.0.1.',
    tone: 'bg-white',
    boxes: [
      { title: 'Reads', text: 'capabilities · recipe · session · comparison · R1 results.' },
      { title: 'Commands', text: 'create session · recommend · feedback / cancel / close · compare. JSON, an idempotency key, and the expected revision.' },
    ],
  },
  {
    name: 'This application',
    note: 'Renders backend values. Computes none.',
    tone: 'bg-teal-soft',
    boxes: [
      { title: 'Never computes', text: 'Probabilities, utilities, estimates, regret, oracle values, set membership, state updates, costs.' },
      { title: 'Never retries', text: 'A repeated command is a new human decision. Recovery replays the identical journaled request only when you ask.' },
      { title: 'Keeps worlds apart', text: 'Human, synthetic, hypothetical, oracle and historical evidence each have their own surface and label.' },
    ],
  },
];

const FLOW: string[] = [
  'The forecast is saved before the reaction exists, and there is no path from a forecast to the outcome.',
  'Private synthetic tendencies reach only the outcome generator and the oracle, never a policy, predictor or allocator.',
  'Branch paths are hypothetical and never write factual history or state.',
  'The exhaustive oracle is never an input to prediction or allocation.',
  'Only the application layer commits sessions; only recorded or journaled decisions answer guarded requests offline.',
];

const LIMITS: string[] = [
  'The six state variables and their update deltas are engineering choices. They are not validated measurements of any psychological construct, even after human feedback.',
  'The hard filter is approximate keyword screening plus numeric limits on imperfect catalog metadata. It matches exact single whole words, so multi-word entries never match and plural forms are missed; allergy and exclusion inputs are therefore disabled in this release, and pescatarian and “other” (which have no rule) cannot be selected. Vegetarian and vegan screening miss some plural forms. None of this is dietary compliance or allergy safety.',
  'Free-text requests are soft instructions: only the guarded LLM sees them, and no policy treats them as a search or a constraint.',
  'The catalog is a bounded subset; candidate windows (48 recipes) restrict what a policy can select. Health scores are catalog-derived proxies. Ingredient count is a cost proxy, not a price.',
  'Predictors and conformal thresholds are frozen on synthetic reference data. There is no guaranteed coverage for human feedback or shifted contexts. Branches always use the frozen population predictor. An independent audit found MODIFY_CLARIFY as the most probable class in 42 of 48 structured reference turns and weak contextual adaptation over 12 turns; predictor v1 is kept unchanged.',
  'Known simulator defect, kept for reproducibility: the structured simulator treats a recipe whose normalized health score is exactly 0 like a missing score (neutral 0.5), which can affect synthetic outcomes.',
  'Branching is two reaction deep with continuation fixed to CONTINUE, and clarification branches carry residual text only. Limited estimates renormalize visited probability mass and are not unbiased full-tree expectations.',
  'The oracle is exhaustive only for this bounded synthetic objective and is simulator-dependent. A human oracle does not exist.',
  'Offline, the guarded-LLM policy answers only 77 exact recorded contexts. New scenarios usually receive “recorded context unavailable”, honestly, with no substitute.',
  'Live guarded mode makes real provider calls. This application sends a guarded recommendation only after explicit per-session consent, runs live guarded sessions one turn at a time, does not send guarded branch comparisons (their preparation pass could need up to 21 provider decisions), and never retries an unknown completion.',
  'A synchronous comparison cannot report progress or be cancelled, and it holds a write transaction while it runs.',
  'Historical R1 results are frozen aggregates. Positive guarded gain and strict PCUB superiority were not established, and the R1 program is not formally closed. No new human study is established by this application.',
  'This is a single-machine local application. There are no user accounts, and a session id is an identifier, not a credential. It is not a hosted multi-user service.',
];

const TERMS: [string, string][] = [
  ['Forecast', 'Four reaction probabilities, saved before the reaction exists. Not an outcome.'],
  ['Reaction', 'ACCEPT, MODIFY_CLARIFY, DEFER or REJECT for the current recommendation. Continuation (CONTINUE or DISENGAGE) is a separate flag.'],
  ['Prequential', 'Predict first; adapt only after the true label is revealed.'],
  ['Factual', 'Realized in the declared world: human-submitted, or generated inside a simulation. “Factual” does not mean “human”.'],
  ['Hypothetical / counterfactual', 'A modeled path in a branch tree. Nothing in it happened.'],
  ['Allocator', 'A rule choosing which hypothetical node to expand next. It does not choose recipes.'],
  ['Budget', 'The number of node expansions in the evaluation (2, 4, 8, 12). Preparation covers the whole 20-node forest first.'],
  ['Limited estimate', 'A policy value from visited probability mass only.'],
  ['Oracle', 'Synthetic-only exhaustive evaluation using the simulator’s private probabilities.'],
  ['Regret', 'Oracle-best value minus the oracle value of the policy the limited evaluation selected.'],
  ['Conformal set', 'A set of plausible labels from a frozen calibration threshold. Diagnostic only.'],
  ['Provenance', 'World, reaction origin, evidence status and execution mode attached to evidence by the backend.'],
  ['Idempotency key', 'Lets a repeated identical command return its original response instead of repeating its effect.'],
];

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="surface p-5">
      <h2 className="text-xl">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function MethodPage() {
  const caps = useCapabilities().data;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl">Method, architecture and limits</h1>
        <p className="mt-1 max-w-3xl text-muted">
          How the system fits together, which parts are allowed to change state, and what it does <strong>not</strong> claim. This page describes only what is
          implemented.
        </p>
        <p className="mt-2 text-sm">
          For an interactive version, open the{' '}
          <Link to="/architecture" className="text-teal underline">
            Architecture explorer
          </Link>
          .
        </p>
      </header>

      <section aria-labelledby="arch" className="space-y-3">
        <h2 id="arch" className="text-2xl">
          Architecture and authority
        </h2>
        <Notice />
        <ol className="m-0 list-none space-y-3 p-0">
          {LAYERS.map((l, i) => (
            <li key={l.name} className={`rounded-lg border border-rule p-4 ${l.tone}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg">
                  <span className="mono mr-2 text-sm text-muted">L{LAYERS.length - i}</span>
                  {l.name}
                </h3>
                <p className="text-xs text-muted">{l.note}</p>
              </div>
              <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
                {l.boxes.map((b) => (
                  <li key={b.title} className="rounded border border-rule bg-white/80 p-3 text-sm">
                    <p className="font-semibold">{b.title}</p>
                    <p className="mt-0.5 text-muted">{b.text}</p>
                    {b.who && <p className="mt-1 text-xs font-medium text-warn">{b.who}</p>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="surface p-4">
          <h3 className="text-lg">Information boundaries</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {FLOW.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Policies">
          <ul className="m-0 list-none space-y-3 p-0 text-sm">
            {(caps?.policies ?? Object.keys(POLICY_LABEL)).map((p) => (
              <li key={p}>
                <p className="font-semibold">{POLICY_LABEL[p]?.label ?? p}</p>
                <p className="mono text-xs text-muted">{p}</p>
                <p className="text-muted">{POLICY_LABEL[p]?.blurb}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Predictors">
          <ul className="m-0 list-none space-y-3 p-0 text-sm">
            {(caps?.predictors ?? Object.keys(PREDICTOR_LABEL)).map((p) => (
              <li key={p}>
                <p className="font-semibold">{PREDICTOR_LABEL[p]?.label ?? p}</p>
                <p className="text-muted">{PREDICTOR_LABEL[p]?.blurb}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Allocators and budgets">
          <ul className="m-0 list-none space-y-3 p-0 text-sm">
            {(caps?.allocators ?? Object.keys(ALLOCATOR_LABEL)).map((a) => (
              <li key={a}>
                <p className="font-semibold">{ALLOCATOR_LABEL[a]?.label ?? a}</p>
                <p className="text-muted">{ALLOCATOR_LABEL[a]?.blurb}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            Budgets offered by this backend: <span className="mono">{caps ? caps.budgets.join(', ') : '…'}</span> expansions; branch depth{' '}
            <span className="mono">{caps?.branch_depth ?? '…'}</span>.
          </p>
        </Card>
      </div>

      <Card title="How a comparison works">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Start from a <strong>pending</strong> recommendation. Both policies recompute their own root action from the same factual root.</li>
          <li>The backend prepares the full 20-node observable forest. In live mode this step could use provider calls; offline it reads recorded decisions only.</li>
          <li>The allocator expands up to your budget of nodes, one at a time. Each node pairs both policies’ downstream recipes and utilities under the same reaction path.</li>
          <li>Limited estimates average only visited probability mass per depth, and the larger estimate selects a policy.</li>
          <li>For synthetic sessions, the oracle independently enumerates all four-by-four reaction paths with the simulator’s private probabilities and reports regret.</li>
          <li>The job is stored as an immutable record. Your session is unchanged.</li>
        </ol>
      </Card>

      <Card title="Provider cost semantics">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Logical counters</strong> (recommender and predictor calls) measure internal simulation work and are not provider calls.
          </li>
          <li>
            <strong>Preparation</strong> and <strong>evaluation</strong> costs are reported separately; unknown token counts stay “unknown”, never zero.
          </li>
          <li>
            <strong>Recorded or cached reuse</strong> is not a fresh provider charge, yet a cached live decision keeps live provenance.
          </li>
          <li>A provider request that may have completed without a durable record is an unknown completion. It is never retried automatically.</li>
        </ul>
      </Card>

      <section aria-labelledby="lim" className="surface-oracle p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="lim" className="text-2xl">
            Limitations and non-claims
          </h2>
          <EvidenceLabel tone="oracle">Read before interpreting results</EvidenceLabel>
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Historical evidence lives apart from interactive results in the{' '}
          <Link to="/r1" className="text-teal underline">
            frozen R1 archive
          </Link>
          .
        </p>
      </section>

      <Card title="Glossary">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {TERMS.map(([t, d]) => (
            <div key={t}>
              <dt className="font-semibold">{t}</dt>
              <dd className="text-sm text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function Notice() {
  return (
    <p className="rounded border-l-4 border-teal bg-teal-soft p-3 text-sm">
      <strong>Not a swarm of autonomous language-model agents.</strong> The “roles” of the original proposal — recommendation, prediction, memory, evaluation —
      are ordinary deterministic or statistical modules. The only language-model component is the optional guarded scorer, which may score a safe shortlist and
      nothing else: it cannot produce an outcome, change state, relax a constraint, or touch the oracle.
    </p>
  );
}
