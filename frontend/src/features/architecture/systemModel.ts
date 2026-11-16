/**
 * Architecture Explorer — System Map model.
 *
 * Static, documentation-grade description of the IMPLEMENTED system, grounded in
 * docs/reference/MASTER_SYSTEM_REPORT.md, docs/reference/CODE_ARCHITECTURE_REFERENCE.md,
 * docs/reference/API_CONTRACT.md and the observed wire contract (docs/OBSERVED_CONTRACT_NOTES.md).
 * No value here is a scientific result; nothing is fetched or computed.
 *
 * "Agent" nodes are FUNCTIONAL ROLES. They are realised by deterministic or statistical
 * modules; the only optional language-model component is the guarded scorer policy.
 *
 * Geometry is hand-designed in a 1200 × 770 viewBox: five columns (x = 10, 246, 482, 718, 954;
 * width 210) with routing gutters between them. Connectors use explicit orthogonal
 * waypoints so that no connector passes through a node.
 */

export type NodeKind = 'interface' | 'orchestration' | 'role' | 'component' | 'store' | 'asset' | 'archive';

export interface Member {
  name: string;
  id?: string;
  text: string;
}

export interface ArchNode {
  id: string;
  /** Title, already split into display lines for the diagram. */
  lines: string[];
  /** Plain-text title for lists and inspectors. */
  title: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Compact member names drawn inside the node (e.g. the four policies). */
  chips?: string[];
  /** True only for the component that may call a language model. */
  llm?: boolean;
  summary: string;
  implementation: string;
  inputs: string[];
  outputs: string[];
  reads: string[];
  writes: string[];
  persistence: string;
  evidence: string;
  limits: string[];
  members?: Member[];
  links?: { to: string; label: string }[];
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** structure = always drawn; flow = drawn when an endpoint is selected (or "show all flows"). */
  tier: 'structure' | 'flow';
  /** Dashed: only in an optional mode (live provider). */
  optional?: boolean;
  points: [number, number][];
  /**
   * Label placement. Default: centred on the longest segment.
   * 'rotate' = along the longest vertical segment (for gutter runs);
   * [x, y] = fixed anchor; 'none' = relation shown in the inspector only.
   */
  labelPlace?: 'rotate' | 'none' | [number, number];
}

export const VIEWBOX = { w: 1200, h: 770 };

export const KIND_LABEL: Record<NodeKind, string> = {
  interface: 'Interface',
  orchestration: 'Orchestration',
  role: 'Functional agent role',
  component: 'Implementation module',
  store: 'Runtime store',
  asset: 'Frozen asset',
  archive: 'Frozen historical evidence',
};

export const ROLE_NOTE =
  'This is a functional agent role, not an autonomous language-model process. In the current runtime it is carried out by deterministic or statistical modules. The only optional language-model component in the whole system is the guarded scorer policy, which can only score a safe shortlist.';

export const NODES: ArchNode[] = [
  /* ------------------------------------------------------------ interface */
  {
    id: 'frontend',
    lines: ['Frontend application'],
    title: 'Frontend application (this interface)',
    kind: 'interface',
    x: 200,
    y: 16,
    w: 260,
    h: 52,
    summary:
      'The browser application you are using. It sends commands to the local API and renders exactly what the backend returns, keeping each kind of evidence on its own labelled surface.',
    implementation: 'React + TypeScript single-page application, served locally by Vite; same-origin proxy to the API.',
    inputs: ['Your structured choices (persona, constraints, reaction, comparison settings)', 'Backend JSON responses'],
    outputs: ['HTTP commands with an idempotency key and the expected revision', 'Rendered evidence surfaces'],
    reads: ['All public API responses', 'Browser-local command journal and session index'],
    writes: ['Browser storage only (journal, local index, observed-state points). Never backend state directly.'],
    persistence: 'Browser localStorage for the command journal, the list of sessions/comparisons it has seen, and observed state points. Lost if site data is cleared; the backend data is unaffected.',
    evidence: 'Displays backend provenance verbatim; adds no evidence of its own.',
    limits: [
      'Computes no scientific value (no probabilities, utilities, estimates, regret, oracle values or costs).',
      'Never retries a command automatically; recovery is a user-initiated replay of the identical request.',
      'On a live-capable backend: sends a guarded-LLM recommendation only after explicit per-session consent, one turn per click, and never sends guarded branch comparisons.',
    ],
    links: [
      { to: '/system', label: 'System page (journal, capabilities)' },
      { to: '/lab', label: 'Live Session' },
    ],
  },
  {
    id: 'api',
    lines: ['Local HTTP API'],
    title: 'Local HTTP API (9 endpoints)',
    kind: 'interface',
    x: 500,
    y: 16,
    w: 260,
    h: 52,
    summary:
      'Nine JSON endpoints on 127.0.0.1: capabilities, recipe, session create/read, recommend, feedback (also cancel/close), comparison create/read, and the frozen R1 results.',
    implementation: 'Python standard-library HTTP server; request validation by strict schemas that reject unknown fields.',
    inputs: ['JSON commands with Idempotency-Key and expected_revision', 'Read requests'],
    outputs: ['Session, comparison, recipe, capability and R1 JSON', 'Typed error codes'],
    reads: ['Session/comparison store', 'Frozen assets', 'R1 tables'],
    writes: ['Nothing itself; commands are delegated to the session orchestrator'],
    persistence: 'None of its own.',
    evidence: 'Transports evidence; does not create it.',
    limits: [
      'Local-only (binds 127.0.0.1). No user accounts or per-resource authorisation; a session id is an identifier, not a credential.',
      'Comparisons are synchronous: no progress reporting, no cancellation endpoint.',
      'There is no endpoint to list sessions, comparisons or synthetic fixtures.',
    ],
    links: [{ to: '/system', label: 'Declared capabilities' }],
  },

  /* ----------------------------------------------------------- orchestration */
  {
    id: 'orchestrator',
    lines: ['Session Orchestrator'],
    title: 'Session Orchestrator',
    kind: 'orchestration',
    x: 440,
    y: 112,
    w: 380,
    h: 52,
    summary:
      'Coordinates every turn: checks the expected revision, builds the safe candidate context, asks the policy and predictor, persists the pending forecast, applies the revealed outcome exactly once, and launches comparisons.',
    implementation:
      'Application services (sessions and comparisons) wrapping each command in one SQLite transaction (BEGIN IMMEDIATE) with an idempotency record.',
    inputs: ['Validated API commands', 'Current session body'],
    outputs: ['Updated session with a new revision', 'Comparison job records'],
    reads: ['Session body: persona, plan, state, history, pending recommendation, adapter state'],
    writes: [
      'Pending recommendation + forecast (revision +1)',
      'History, state, evidence and adapter update on reveal (revision +1)',
      'Cancelled list and closed status on cancel/close',
      'Idempotency response rows',
    ],
    persistence: 'Session and comparison store (SQLite). A repeated identical command returns the stored response instead of acting twice.',
    evidence: 'Assigns provenance (world, reaction origin, evidence status, execution mode) to what it commits.',
    limits: [
      'Exactly-once applies to committed effects under the idempotency rules, not to network delivery.',
      'Changing policy, predictor, simulator or constraints requires a new scenario.',
    ],
    links: [{ to: '/lab', label: 'Run a session' }],
  },
  {
    id: 'store',
    lines: ['Session & comparison store'],
    title: 'Session & comparison store (SQLite)',
    kind: 'store',
    x: 880,
    y: 112,
    w: 284,
    h: 52,
    summary:
      'Runtime database holding each session as a JSON body, each comparison job, and the idempotency responses that make repeated commands safe.',
    implementation: 'SQLite with three tables (sessions, jobs, requests); WAL mode, synchronous FULL.',
    inputs: ['Session bodies and job records from the orchestrator'],
    outputs: ['Persisted sessions and jobs for later reads (also after a restart)'],
    reads: ['—'],
    writes: ['sessions, jobs, requests tables'],
    persistence: 'This is the persistence layer. Runtime-mutable; separate from frozen assets.',
    evidence: 'Stores factual session evidence and hypothetical comparison records side by side, each with its own provenance.',
    limits: [
      'A comparison job never updates a session.',
      'No incremental or resumable job rows: a comparison is written only when it has completed.',
      'Which database file is used is decided by whoever starts the backend.',
    ],
  },

  /* ---------------------------------------------------------------- roles */
  {
    id: 'rec',
    lines: ['Conversational', 'Recommendation Agent'],
    title: 'Conversational Recommendation Agent',
    kind: 'role',
    x: 10,
    y: 212,
    w: 210,
    h: 84,
    summary:
      'Constraint-aware recommendation role: chooses one recipe per turn from the safe candidate window using the scenario’s policy.',
    implementation: 'Hard-constraint filter followed by the selected recommendation policy (deterministic, constraint-only, feedback-sequence, or the optional guarded LLM scorer).',
    inputs: ['Persona and declared hard constraints', 'Request text (fixed per scenario)', 'Completed history and engineered state', 'Candidate window'],
    outputs: ['Selected recipe, ranked window, rationale (provenance), constraint evidence'],
    reads: ['Public session context only — never private synthetic tendencies'],
    writes: ['Nothing directly; the orchestrator persists its output'],
    persistence: 'Through the orchestrator (pending recommendation).',
    evidence: 'Recommendation provenance: execution mode deterministic, recorded_guarded or live_guarded.',
    limits: ['Structured turns, not free natural-language dialogue.', 'Ranks a ~48-recipe window, not the whole catalog.'],
    links: [{ to: '/lab', label: 'Get a recommendation in Live Session' }],
  },
  {
    id: 'ubpa',
    lines: ['User Behavior', 'Prediction Agent (UBPA)'],
    title: 'User Behavior Prediction Agent (UBPA)',
    kind: 'role',
    x: 246,
    y: 212,
    w: 210,
    h: 84,
    summary:
      'Forecasting role: before any reaction exists, estimates the probability of ACCEPT, MODIFY_CLARIFY, DEFER and REJECT for the recommended recipe.',
    implementation: 'Population, class-bias or contextual four-class predictor over a frozen 101-feature pipeline; conformal reference sets as diagnostics.',
    inputs: ['Recommended action', 'Public profile features, request, past-only history, engineered state'],
    outputs: ['Four reaction probabilities (pre-outcome forecast)', 'Population probabilities and conformal reference sets'],
    reads: ['Observable, pre-reaction information only'],
    writes: ['Pending adapter state (class-bias/contextual), committed by the orchestrator'],
    persistence: 'Forecast stored as part of the pending recommendation, then kept unchanged in evidence.',
    evidence: 'Forecast · pending (reaction origin null).',
    limits: [
      'Forecasts never create the outcome.',
      'Trained on synthetic reference data; no human predictive validity is established.',
      'Conformal sets are frozen synthetic diagnostics with no human coverage guarantee and never prune branches.',
    ],
  },
  {
    id: 'usersim',
    lines: ['User Simulation Agent /', 'human feedback source'],
    title: 'User Simulation Agent / human feedback source',
    kind: 'role',
    x: 482,
    y: 212,
    w: 210,
    h: 84,
    summary:
      'Outcome-producing role. In synthetic sessions an independent simulator generates the reaction; in human sessions the person replaces this role by submitting structured feedback.',
    implementation: 'Structured simulator or agenda-derived simulator (synthetic); structured feedback command (human).',
    inputs: ['Recommended action', 'Synthetic only: private profile tendencies, recipe fit, history, state'],
    outputs: ['Realized reaction, continuation flag, requested changes'],
    reads: ['Synthetic only: private profile — hidden from policies, predictors and allocators'],
    writes: ['Nothing directly; the outcome is committed by the orchestrator'],
    persistence: 'Outcome stored in history and evidence.',
    evidence: 'Human-submitted · factual, or Synthetic · factual within the simulation.',
    limits: [
      'Synthetic outcomes are simulator behaviour, not human behaviour.',
      'A human outcome is one structured submission, not a validated human study.',
      'Free text is stored as a requested change and never read as a reaction.',
    ],
    links: [{ to: '/lab', label: 'Choose human or synthetic in Live Session' }],
  },
  {
    id: 'memory',
    lines: ['Longitudinal', 'Memory Manager'],
    title: 'Longitudinal Memory Manager',
    kind: 'role',
    x: 718,
    y: 212,
    w: 210,
    h: 84,
    summary:
      'Keeps the longitudinal record of a scenario: ordered completed history, six engineered state variables, requested-change history, and the transition applied after each reveal.',
    implementation: 'Fixed state-transition rule plus ordered history in the session body.',
    inputs: ['Revealed outcome', 'Current state and history'],
    outputs: ['Next state, extended history, recent requested changes'],
    reads: ['Current session state and history'],
    writes: ['State, history and evidence (via the orchestrator’s atomic commit)'],
    persistence: 'Session body in the store; carries over across turns and segments within one scenario.',
    evidence: 'Factual history in the declared world.',
    limits: [
      'Continuity exists within one scenario/session (across its turns and segments). A new scenario starts with fresh history, state and adaptation; no learned identity transfers between scenarios.',
      'The six variables are engineered, not validated psychological measurements.',
    ],
  },
  {
    id: 'cfe',
    lines: ['Counterfactual', 'Evaluation Agent'],
    title: 'Counterfactual Evaluation Agent',
    kind: 'role',
    x: 954,
    y: 212,
    w: 210,
    h: 84,
    summary:
      'Compares two policies from a pending factual root by exploring hypothetical reaction paths two steps deep, within a budget, and (synthetic only) against an exhaustive simulator reference.',
    implementation: 'Paired branch engine, one of four allocators, visited-mass limited estimator, synthetic oracle and comparison metrics.',
    inputs: ['Pinned pending root (revision-checked)', 'Two distinct policies, allocator, budget, oracle flag'],
    outputs: ['Hypothetical nodes, expansion order, limited estimates, selected policy', 'Synthetic only: oracle values, regret and metrics'],
    reads: ['Public root projection of the session; private profile only for the oracle'],
    writes: ['A new immutable comparison job — never the session'],
    persistence: 'Comparison job in the store.',
    evidence: 'Hypothetical · counterfactual; oracle values are a synthetic reference.',
    limits: ['Two reaction depths only; continuation fixed to CONTINUE in branches.', 'Synchronous; no progress or cancellation.', 'One comparison is one case, not a general result.'],
    links: [{ to: '/lab', label: 'Run a comparison from a pending turn' }],
  },

  /* ------------------------------------------------------- implementations */
  {
    id: 'filter',
    lines: ['Hard-constraint filter'],
    title: 'Hard-constraint filter',
    kind: 'component',
    x: 10,
    y: 344,
    w: 210,
    h: 52,
    summary: 'Removes every candidate that violates the declared hard constraints before any ranking. Constraints are never relaxed.',
    implementation: 'Deterministic rule filter over catalog text and structured limits.',
    inputs: ['Candidate window', 'Dietary pattern (vegetarian/vegan keyword lists), total-time/ingredient/instruction/serving limits; allergy and exclusion lists (disabled in this release’s interface)'],
    outputs: ['Safe candidate context, or NO_SAFE_RECOMMENDATION'],
    reads: ['Recipe metadata (ingredients, title, tags, limits)'],
    writes: ['Nothing'],
    persistence: 'None.',
    evidence: 'Constraint evidence on the recommendation.',
    limits: [
      'Approximate keyword screening over imperfect metadata; allergen label lists are empty in this catalog subset.',
      'Matching is exact single whole words: multi-word entries ("peanut butter") never match and plural forms are missed ("peanut" vs "peanuts"). The interface therefore disables allergy and exclusion inputs.',
      'Vegetarian/vegan use fixed single-word lists that miss some plurals (e.g. "sausages", "prawns"); pescatarian and "other" have no rule and are disabled in the interface.',
      'Missing metadata for a requested limit excludes the recipe.',
      'Not an allergy or clinical safety certification.',
    ],
  },
  {
    id: 'policies',
    lines: ['Recommendation policies'],
    title: 'Recommendation policies (4)',
    kind: 'component',
    x: 10,
    y: 424,
    w: 210,
    h: 118,
    chips: ['Deterministic', 'Constraint-only', 'Feedback-sequence', 'Guarded LLM scorer ◇'],
    llm: true,
    summary: 'Rank the safe candidates. All four share the same window and filter, so their differences are ranking differences.',
    implementation: 'Three deterministic scorers and one guarded LLM shortlist scorer (all version 1).',
    inputs: ['Safe candidate context', 'Persona, request, history, state'],
    outputs: ['Ranked recipe ids, selected recipe, rationale'],
    reads: ['Public context only'],
    writes: ['Nothing directly'],
    persistence: 'Through the orchestrator.',
    evidence: 'Execution mode: deterministic, recorded_guarded or live_guarded.',
    limits: [
      'Guarded LLM scorer: offline it answers only requests that exactly match one of 77 recorded contexts; otherwise RECORDED_CONTEXT_UNAVAILABLE and nothing is substituted.',
      'R1 found no positive guarded utility gain.',
    ],
    members: [
      { name: 'Deterministic', id: 'deterministic_recipe_recommendation', text: 'Health, protein, sodium and taste-word matches over the 48-recipe window. Does not use the six state variables.' },
      { name: 'Constraint-only', id: 'constraint_only_baseline', text: 'First safe recipe by id. A deliberate control.' },
      { name: 'Feedback-sequence', id: 'feedback_sequence_recipe_recommendation', text: 'Adds fatigue-weighted effort, typed health/effort requests and similarity to earlier accepted/rejected recipes.' },
      {
        name: 'Guarded LLM scorer ◇',
        id: 'guarded_llm_score_vector',
        text: 'The only optional language-model component: integer 0–100 scores over a deterministic safe shortlist of ≤ 10 recipes. Cannot add recipes, relax constraints or decide outcomes.',
      },
    ],
    links: [{ to: '/method', label: 'Policy details (Method)' }],
  },
  {
    id: 'predictors',
    lines: ['Predictor modes'],
    title: 'Predictor modes (3)',
    kind: 'component',
    x: 246,
    y: 344,
    w: 210,
    h: 100,
    chips: ['Population (frozen)', 'Class bias', 'Contextual'],
    summary: 'Produce the four-class reaction forecast. The mode is fixed per scenario.',
    implementation: 'Frozen multinomial logistic regression; class-bias and contextual adapters update after each reveal.',
    inputs: ['Encoded pre-reaction features'],
    outputs: ['Four probabilities in canonical order'],
    reads: ['Frozen model bundle; scenario-owned adapter state'],
    writes: ['Adapter state after reveal (class-bias counts / contextual weights)'],
    persistence: 'Adapter state inside the session body; population model never changes.',
    evidence: 'Forecast · pending.',
    limits: [
      'Adaptation is owned by one profile and scenario; it never transfers elsewhere.',
      'Branch comparisons always use the frozen population predictor, not the session’s adapter.',
    ],
    members: [
      { name: 'Population', id: 'population', text: 'Frozen probabilities; no per-session learning. Equals the population vector exactly.' },
      { name: 'Class bias', id: 'class_bias', text: 'Shifts the population forecast toward this scenario’s revealed reaction counts.' },
      { name: 'Contextual', id: 'contextual', text: 'Learns a small correction on observable features after each reveal.' },
    ],
  },
  {
    id: 'simulators',
    lines: ['Simulator backends'],
    title: 'Simulator backends (2)',
    kind: 'component',
    x: 482,
    y: 344,
    w: 210,
    h: 82,
    chips: ['Structured', 'Agenda-derived'],
    summary: 'Independent synthetic outcome generators. The predictor never sees their private inputs.',
    implementation: 'Structured: logits from private tendencies, fit, history and state, softmax at temperature 0.92, seeded draw. Agenda-derived: deterministic rules, one-hot.',
    inputs: ['Recommended action, private profile, history, state'],
    outputs: ['Synthetic reaction, continuation, requested changes, private probabilities and draws (audit)'],
    reads: ['Private profile tendencies from the curated fixture'],
    writes: ['Nothing directly'],
    persistence: 'Outcome stored by the orchestrator; simulator internals shown only as a post-hoc audit.',
    evidence: 'Synthetic · factual within the simulation.',
    limits: ['Simulator behaviour, not human behaviour.', 'The agenda-derived simulator is a food-domain adaptation, not the full official UserSimCRS.'],
    members: [
      { name: 'Structured', id: 'current_structured_simulator@1', text: 'Seeded probabilistic draw from private tendencies and context.' },
      { name: 'Agenda-derived', id: 'usersimcrs_agenda_derived@1', text: 'Rule-based; one-hot reaction vector; no random draw.' },
    ],
  },
  {
    id: 'human',
    lines: ['Structured human feedback'],
    title: 'Structured human feedback',
    kind: 'component',
    x: 482,
    y: 452,
    w: 210,
    h: 56,
    summary: 'In human sessions, you supply the outcome: one of four reactions, a continuation flag and optional typed requested changes.',
    implementation: 'Feedback command validated against the pending recommendation id and the expected revision.',
    inputs: ['Your reaction, continuation, requested changes'],
    outputs: ['Human outcome for the pending recommendation'],
    reads: ['—'],
    writes: ['Nothing directly'],
    persistence: 'Stored in history and evidence by the orchestrator.',
    evidence: 'Human-submitted · factual.',
    limits: ['A structured submission, not free conversation.', 'Human DISENGAGE closes the session.'],
    links: [{ to: '/lab', label: 'Start a human session' }],
  },
  {
    id: 'transition',
    lines: ['State & history', 'transition'],
    title: 'State & history transition',
    kind: 'component',
    x: 718,
    y: 344,
    w: 210,
    h: 164,
    chips: ['trust', 'motivation', 'fatigue', 'satisfaction', 'engagement', 'resistance'],
    summary: 'After a reveal, appends the turn to the history and moves the six engineered variables by a fixed reaction-dependent delta (clamped to [0,1], rounded to 4 decimals).',
    implementation: 'Deterministic transition rule; requested-change instructions appended to recent preferences (last 12 kept).',
    inputs: ['Revealed reaction and requested changes', 'Current state'],
    outputs: ['Next state and history entry'],
    reads: ['Current state'],
    writes: ['State, history, recent preferences (committed atomically with the adapter update)'],
    persistence: 'Session body.',
    evidence: 'Factual history in the declared world.',
    limits: ['Engineered variables, not measurements of trust, fatigue or any psychological state — even after human feedback.', 'Rejection does not automatically fill “avoided recently”.'],
  },
  {
    id: 'engine',
    lines: ['Paired branch engine'],
    title: 'Paired branch engine',
    kind: 'component',
    x: 954,
    y: 344,
    w: 210,
    h: 52,
    summary: 'Builds the two-depth hypothetical forest from the factual root: 4 first reactions × 4 second reactions = 20 paired nodes, each carrying both policies’ next recipes, probabilities and utilities.',
    implementation: 'Prepares the full 20-node forest first, then runs a budget-limited evaluation with the chosen allocator.',
    inputs: ['Public root projection', 'Both policies', 'Frozen population predictor'],
    outputs: ['Nodes, expansion order, logical counters, limited estimates, selected policy'],
    reads: ['Public root only'],
    writes: ['Nothing to the session; results go into the comparison job'],
    persistence: 'Comparison job.',
    evidence: 'Hypothetical · counterfactual.',
    limits: ['Branch continuation is always CONTINUE; hypothetical clarifications carry residual text only.', 'Limited estimates renormalize visited mass: not unbiased expectations.'],
  },
  {
    id: 'allocators',
    lines: ['Allocators'],
    title: 'Allocators (4)',
    kind: 'component',
    x: 954,
    y: 424,
    w: 210,
    h: 118,
    chips: ['Equal', 'Greedy', 'Uncertainty-first', 'PCUB'],
    summary: 'Choose which hypothetical node to expand next within the budget (2, 4, 8 or 12). They never choose recipes.',
    implementation: 'Frontier selection rules with deterministic tie-breaking.',
    inputs: ['Frontier candidates with probability and uncertainty'],
    outputs: ['Next node to expand'],
    reads: ['Predicted (population) probabilities only — never oracle values'],
    writes: ['Nothing'],
    persistence: 'Allocator id and expansion order stored in the job.',
    evidence: 'Hypothetical.',
    limits: ['R1 did not establish strict PCUB superiority.', 'Frozen PCUB weights give disagreement zero weight on the structured simulator.'],
    members: [
      { name: 'Equal', id: 'equal_round_robin', text: 'Expands the first-reaction subtree with the fewest expansions.' },
      { name: 'Greedy', id: 'greedy_highest_probability', text: 'Expands the most probable path.' },
      { name: 'Uncertainty-first', id: 'uncertainty_first', text: 'Expands the most uncertain reaction.' },
      { name: 'PCUB', id: 'pcub_probability_uncertainty_disagreement', text: 'Weighted probability, uncertainty, policy disagreement and cost (frozen weights).' },
    ],
  },
  {
    id: 'oracle',
    lines: ['Synthetic oracle'],
    title: 'Exhaustive synthetic oracle',
    kind: 'component',
    x: 954,
    y: 566,
    w: 210,
    h: 52,
    summary: 'Synthetic sessions only: enumerates all 20 nodes for both policies with the simulator’s private probabilities to give each policy a reference value, then the backend reports regret and related metrics.',
    implementation: 'Independent enumeration loop; does not reuse the allocator’s visited subset.',
    inputs: ['Prepared root', 'Private synthetic profile and simulator'],
    outputs: ['Oracle policy values, best policy, exact-tie flag, meaning text; regret and metrics'],
    reads: ['Private simulator probabilities'],
    writes: ['Nothing to the session; values go into the comparison job'],
    persistence: 'Comparison job (oracle, metrics).',
    evidence: 'Synthetic reference · not human truth.',
    limits: ['Simulator-relative; never human ground truth.', 'No human oracle exists; human comparisons report it as absent.', 'Never an input to the predictor or allocator.'],
  },

  /* ---------------------------------------------------------- frozen assets */
  {
    id: 'assets',
    lines: ['Frozen assets', '& models'],
    title: 'Frozen assets and models',
    kind: 'asset',
    x: 10,
    y: 700,
    w: 210,
    h: 56,
    summary: '320 hash-verified files: the 10,000-recipe HUMMUS food-only catalog subset, two frozen model bundles, allocator weights, recorded decisions, curated fixtures and R1 tables.',
    implementation: 'Files verified against a manifest fingerprint at startup; missing or altered assets stop the service.',
    inputs: ['—'],
    outputs: ['Catalog, model coefficients, thresholds, weights, fixtures'],
    reads: ['—'],
    writes: ['Never modified by any request'],
    persistence: 'Immutable files.',
    evidence: 'Frozen reference data.',
    limits: ['No recipe images; allergen and dietary-label lists are empty in this subset.', 'Health score is a catalog-derived proxy.'],
  },
  {
    id: 'recorded',
    lines: ['Recorded guarded', 'decisions (77)'],
    title: 'Recorded guarded decisions (77)',
    kind: 'asset',
    x: 246,
    y: 700,
    w: 210,
    h: 56,
    summary: 'Exact recorded scoring decisions that let the guarded scorer answer offline when a request’s fingerprint matches exactly.',
    implementation: 'Verified request/response/record triplets; a missing match is reported, never approximated.',
    inputs: ['Decision fingerprint of a guarded request'],
    outputs: ['Recorded decision, or RECORDED_CONTEXT_UNAVAILABLE'],
    reads: ['—'],
    writes: ['Never'],
    persistence: 'Immutable files.',
    evidence: 'Execution mode recorded_guarded; no live provider call.',
    limits: ['New human scenarios generally do not match. A match was observed for a structured synthetic fixture in the real-backend test.'],
  },
  {
    id: 'journal',
    lines: ['Provider journal', '(live mode only)'],
    title: 'Provider journal (live mode only)',
    kind: 'store',
    x: 482,
    y: 700,
    w: 210,
    h: 56,
    summary: 'Used only if the backend is started in live mode: reserves every provider request before sending it, records the raw response, and blocks retries of uncertain completions.',
    implementation: 'Separate SQLite journal with a single-writer OS lock and a total live-call ceiling.',
    inputs: ['Guarded scoring requests (live mode)'],
    outputs: ['Durable provider records and cost accounting'],
    reads: ['Its own records'],
    writes: ['Reservations, raw responses, parsed records'],
    persistence: 'Its own database file, separate from sessions.',
    evidence: 'Execution mode live_guarded.',
    limits: [
      'Not used in offline mode (the default).',
      'An unknown completion must never be retried; this interface stops live requests for the page after one.',
      'The total live-call limit is set when the backend starts and counts every reservation in the journal.',
    ],
  },
  {
    id: 'r1',
    lines: ['Frozen R1 archive'],
    title: 'Frozen R1 archive',
    kind: 'archive',
    x: 954,
    y: 700,
    w: 210,
    h: 56,
    summary: 'Five aggregate tables from the historical R1 experiment, served read-only. Never affected by anything done in this application.',
    implementation: 'Immutable JSON tables returned by GET /v1/reference-results/r1 with formal_closure_present = false.',
    inputs: ['—'],
    outputs: ['primary_comparison, branch_metrics, longitudinal_metrics, llm_accounting, replay_record'],
    reads: ['—'],
    writes: ['Never'],
    persistence: 'Immutable files.',
    evidence: 'Frozen historical R1.',
    limits: ['No positive guarded gain (RQ1); higher sensitivity is not utility (RQ2); strict PCUB superiority not established (RQ3); R1 not formally closed.'],
    links: [{ to: '/r1', label: 'Open the R1 archive' }],
  },
];

const BUS = 188;

export const EDGES: ArchEdge[] = [
  /* structure: always drawn */
  { id: 's-fe-api', from: 'frontend', to: 'api', tier: 'structure', label: 'HTTP /v1', points: [[460, 42], [500, 42]], labelPlace: [480, 92] },
  { id: 's-api-orch', from: 'api', to: 'orchestrator', tier: 'structure', label: 'validated commands', points: [[630, 68], [630, 112]] },
  { id: 's-orch-store', from: 'orchestrator', to: 'store', tier: 'structure', label: 'commits', points: [[820, 138], [880, 138]] },
  ...(['rec', 'ubpa', 'usersim', 'memory', 'cfe'] as const).map((id, i) => {
    const cx = [115, 351, 587, 823, 1059][i]!;
    return { id: `s-orch-${id}`, from: 'orchestrator', to: id, tier: 'structure' as const, label: 'coordinates', points: [[630, 164], [630, BUS], [cx, BUS], [cx, 212]] as [number, number][] };
  }),
  { id: 's-rec-filter', from: 'rec', to: 'filter', tier: 'structure', label: 'filter first', points: [[115, 296], [115, 344]] },
  { id: 's-filter-pol', from: 'filter', to: 'policies', tier: 'structure', label: 'safe context', points: [[115, 396], [115, 424]] },
  { id: 's-ubpa-pred', from: 'ubpa', to: 'predictors', tier: 'structure', label: 'forecast', points: [[351, 296], [351, 344]] },
  { id: 's-usim-sim', from: 'usersim', to: 'simulators', tier: 'structure', label: 'synthetic sessions', points: [[587, 296], [587, 344]] },
  { id: 's-usim-human', from: 'usersim', to: 'human', tier: 'structure', label: 'human sessions', points: [[500, 296], [500, 320], [469, 320], [469, 480], [482, 480]], labelPlace: 'rotate' },
  { id: 's-mem-trans', from: 'memory', to: 'transition', tier: 'structure', label: 'apply transition', points: [[823, 296], [823, 344]] },
  { id: 's-cfe-engine', from: 'cfe', to: 'engine', tier: 'structure', label: 'build forest', points: [[1059, 296], [1059, 344]] },
  { id: 's-engine-alloc', from: 'engine', to: 'allocators', tier: 'structure', label: 'next expansion', points: [[1059, 396], [1059, 424]] },
  { id: 's-cfe-oracle', from: 'cfe', to: 'oracle', tier: 'structure', label: 'synthetic only', points: [[970, 296], [970, 316], [941, 316], [941, 580], [954, 580]], labelPlace: 'rotate' },
  { id: 's-api-r1', from: 'api', to: 'r1', tier: 'structure', label: 'read-only', points: [[760, 30], [1182, 30], [1182, 728], [1164, 728]] },

  /* flows: drawn on selection */
  { id: 'f-pol-assets', from: 'policies', to: 'assets', tier: 'flow', label: 'catalog window', points: [[115, 542], [115, 700]] },
  { id: 'f-pred-assets', from: 'predictors', to: 'assets', tier: 'flow', label: 'frozen model bundles', points: [[300, 444], [300, 632], [170, 632], [170, 700]], labelPlace: 'rotate' },
  { id: 'f-sim-assets', from: 'simulators', to: 'assets', tier: 'flow', label: 'private fixture profiles', points: [[692, 370], [700, 370], [700, 644], [60, 644], [60, 700]] },
  { id: 'f-pol-recorded', from: 'policies', to: 'recorded', tier: 'flow', label: 'guarded: exact match only', points: [[220, 490], [228, 490], [228, 656], [330, 656], [330, 700]], labelPlace: 'rotate' },
  { id: 'f-pol-journal', from: 'policies', to: 'journal', tier: 'flow', label: 'live mode only', optional: true, points: [[220, 520], [238, 520], [238, 680], [560, 680], [560, 700]] },
  { id: 'f-sim-trans', from: 'simulators', to: 'transition', tier: 'flow', label: 'synthetic outcome', points: [[692, 400], [718, 400]], labelPlace: 'none' },
  { id: 'f-human-trans', from: 'human', to: 'transition', tier: 'flow', label: 'human outcome', points: [[692, 480], [718, 480]], labelPlace: 'none' },
  { id: 'f-trans-store', from: 'transition', to: 'store', tier: 'flow', label: 'history + state, revision +1', points: [[928, 420], [934, 420], [934, 164]], labelPlace: 'rotate' },
  { id: 'f-trans-pred', from: 'transition', to: 'predictors', tier: 'flow', label: 'after reveal: adapt', points: [[718, 360], [710, 360], [710, 328], [400, 328], [400, 344]] },
  { id: 'f-cfe-store', from: 'cfe', to: 'store', tier: 'flow', label: 'immutable job', points: [[1130, 212], [1130, 164]] },
  { id: 'f-engine-pol', from: 'engine', to: 'policies', tier: 'flow', label: 'both policies re-rank per path', points: [[1000, 344], [1000, 334], [236, 334], [236, 450], [220, 450]], labelPlace: [330, 334] },
  { id: 'f-engine-pred', from: 'engine', to: 'predictors', tier: 'flow', label: 'population model only', points: [[1030, 344], [1030, 340], [420, 340], [420, 344]], labelPlace: [560, 340] },
  { id: 'f-oracle-sim', from: 'oracle', to: 'simulators', tier: 'flow', label: 'private probabilities', points: [[954, 606], [712, 606], [712, 412], [692, 412]] },
];

export const NODE_BY_ID: ReadonlyMap<string, ArchNode> = new Map(NODES.map((n) => [n.id, n]));

/** Ordered groups for the narrow-screen list and keyboard order. */
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Interface', ids: ['frontend', 'api'] },
  { title: 'Orchestration and runtime store', ids: ['orchestrator', 'store'] },
  { title: 'Functional agent roles', ids: ['rec', 'ubpa', 'usersim', 'memory', 'cfe'] },
  { title: 'Implementation modules', ids: ['filter', 'policies', 'predictors', 'simulators', 'human', 'transition', 'engine', 'allocators', 'oracle'] },
  { title: 'Frozen assets, journal and archive', ids: ['assets', 'recorded', 'journal', 'r1'] },
];
