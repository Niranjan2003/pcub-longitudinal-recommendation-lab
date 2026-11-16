/**
 * Longitudinal lifecycle — the factual path of one scenario, step by step.
 * Grounded in MASTER_SYSTEM_REPORT §5–6, §9–11, §19, §21 and verified API behaviour
 * (docs/OBSERVED_CONTRACT_NOTES.md). Static explanation only.
 */
export type Level = 'scenario' | 'segment' | 'turn';

export interface LifecycleStep {
  id: string;
  n: number;
  title: string;
  /** Functional role responsible (as shown on the System Map). */
  role: string;
  /** Hierarchy level the step belongs to. */
  level: Level;
  what: string;
  writes: string;
  evidence: string;
  /** Which station / connector to highlight in the loop diagram. */
  target: string;
}

export const STEPS: LifecycleStep[] = [
  {
    id: 'config',
    n: 0,
    title: 'Scenario configuration',
    role: 'Session Orchestrator',
    level: 'scenario',
    what: 'A scenario fixes its world (human or synthetic), policy, predictor mode, simulator backend, persona and hard constraints, request, and plan (segments × turns per segment). Synthetic scenarios take persona, state, request and plan from a curated fixture.',
    writes: 'New session at revision 0 with empty history and the initial engineered state (six values, 0.5 by default for human sessions).',
    evidence: 'Scenario identity. Changing any fixed choice later means creating a new scenario.',
    target: 'config',
  },
  {
    id: 'window',
    n: 1,
    title: 'Candidate window',
    role: 'Conversational Recommendation Agent',
    level: 'turn',
    what: 'About 48 recipes are taken from the frozen 10,000-recipe catalog by a stable hash of the profile identity, advancing every turn. Policies rank this window, not the whole catalog.',
    writes: 'Nothing yet.',
    evidence: '—',
    target: 'window',
  },
  {
    id: 'filter',
    n: 2,
    title: 'Hard-constraint filtering',
    role: 'Conversational Recommendation Agent',
    level: 'turn',
    what: 'Every candidate that violates a declared hard constraint is removed before ranking. If nothing survives, the turn ends with NO_SAFE_RECOMMENDATION and the revision does not change. Constraints are never relaxed.',
    writes: 'Nothing (a failed turn commits nothing).',
    evidence: 'Constraint evidence on the recommendation. Not an allergy or clinical safety certification.',
    target: 'filter',
  },
  {
    id: 'recommend',
    n: 3,
    title: 'Recommendation',
    role: 'Conversational Recommendation Agent',
    level: 'turn',
    what: 'The scenario’s policy ranks the safe candidates and selects one recipe, with a verbatim rationale. The guarded scorer, if chosen, can answer offline only for an exact recorded context.',
    writes: 'Nothing yet (held until the forecast is ready).',
    evidence: 'Execution mode: deterministic or recorded_guarded (live_guarded only in live mode).',
    target: 'recommend',
  },
  {
    id: 'forecast',
    n: 4,
    title: 'Pre-outcome reaction forecast',
    role: 'User Behavior Prediction Agent (UBPA)',
    level: 'turn',
    what: 'Before any reaction exists, the predictor estimates the probabilities of ACCEPT, MODIFY_CLARIFY, DEFER and REJECT from observable information only. Conformal reference sets are added as frozen synthetic diagnostics.',
    writes: 'Nothing yet.',
    evidence: 'Forecast · pending.',
    target: 'forecast',
  },
  {
    id: 'commit-forecast',
    n: 5,
    title: 'Forecast committed before reveal',
    role: 'Session Orchestrator',
    level: 'turn',
    what: 'The recommendation and its forecast are stored as the pending recommendation in one transaction. Asking again returns the same pending item; it is never re-predicted.',
    writes: 'Pending recommendation + forecast; revision +1. History is NOT extended here.',
    evidence: 'Forecast · pending (reaction origin null).',
    target: 'commit-forecast',
  },
  {
    id: 'outcome',
    n: 6,
    title: 'Outcome: human-submitted OR simulator-generated',
    role: 'User Simulation Agent / human feedback source',
    level: 'turn',
    what: 'A person submits one of the four reactions with a continuation flag and optional typed changes, or an independent simulator generates them from private tendencies the predictor never sees. The forecast has no influence on the outcome.',
    writes: 'Nothing on its own; the outcome is applied in the next step.',
    evidence: 'Human-submitted · factual, or Synthetic · factual within the simulation.',
    target: 'outcome',
  },
  {
    id: 'transition',
    n: 7,
    title: 'Atomic history and state transition',
    role: 'Longitudinal Memory Manager',
    level: 'turn',
    what: 'In one transaction: the turn joins the history, the six engineered variables move by a fixed reaction-dependent delta, requested-change instructions are recorded, and the forecast plus outcome become an evidence record.',
    writes: 'History entry, new state, evidence, recent preferences; pending cleared; revision +1.',
    evidence: 'Factual in the declared world (human or synthetic).',
    target: 'transition',
  },
  {
    id: 'adapt',
    n: 8,
    title: 'Adaptive predictor update (where applicable)',
    role: 'User Behavior Prediction Agent (UBPA)',
    level: 'turn',
    what: 'Only for class-bias or contextual predictors: the revealed label updates this scenario’s adapter, inside the same commit. The frozen population model never changes. Adaptation is owned by this scenario and is never shared.',
    writes: 'Adapter state in the session body (same transaction as step 7).',
    evidence: 'Prequential: predict, then reveal, then update.',
    target: 'adapt',
  },
  {
    id: 'next',
    n: 9,
    title: 'Next turn',
    role: 'Session Orchestrator',
    level: 'turn',
    what: 'The extended history, new state and adapted predictor shape the next window, recommendation and forecast. This is the longitudinal loop.',
    writes: '—',
    evidence: '—',
    target: 'loop',
  },
  {
    id: 'rollover',
    n: 10,
    title: 'Segment rollover',
    role: 'Session Orchestrator',
    level: 'segment',
    what: 'After the last turn of a segment, the next turn is turn 1 of the next segment (the plan calls segments “sessions”: number_of_sessions, session_index). History, state and adaptation carry over unchanged.',
    writes: 'Nothing extra; only the position advances.',
    evidence: 'Verified with a 2 × 2 plan: the third completed turn is segment 2, turn 1.',
    target: 'gate',
  },
  {
    id: 'subsequent',
    n: 11,
    title: 'Subsequent turns',
    role: 'All roles',
    level: 'segment',
    what: 'Steps 1–8 repeat for every turn of every segment, each time from the committed history and state.',
    writes: 'One pending commit and one reveal commit per turn.',
    evidence: '—',
    target: 'all',
  },
  {
    id: 'closure',
    n: 12,
    title: 'Session closure',
    role: 'Session Orchestrator',
    level: 'scenario',
    what: 'The session closes when the planned horizon is complete, when a human chooses DISENGAGE, or on cancel/close (which record no reaction). A synthetic DISENGAGE is recorded but does not close the session. A closed session is a read-only record.',
    writes: 'Status closed; cancel moves a pending item to the cancelled list.',
    evidence: 'The full factual record remains readable.',
    target: 'closure',
  },
];

export interface PersistRow {
  item: string;
  turn: string;
  turns: string;
  segments: string;
  scenarios: string;
}

/** What persists, and how far. "—" = not applicable. */
export const PERSISTENCE: PersistRow[] = [
  { item: 'Completed history (reactions, recipes, positions)', turn: 'extended once on reveal', turns: 'kept', segments: 'kept', scenarios: 'not shared' },
  { item: 'Six engineered state variables', turn: 'updated once on reveal', turns: 'kept', segments: 'kept', scenarios: 'new scenario starts fresh' },
  { item: 'Requested-change history (recent preferences, last 12)', turn: 'appended on reveal', turns: 'kept', segments: 'kept', scenarios: 'not shared' },
  { item: 'Adapter state (class-bias / contextual)', turn: 'updated once on reveal', turns: 'kept', segments: 'kept', scenarios: 'owned by one scenario; never transferred' },
  { item: 'Frozen population model', turn: 'read only', turns: 'unchanged', segments: 'unchanged', scenarios: 'unchanged (frozen asset)' },
  { item: 'Pending forecast', turn: 'created, then moved into evidence', turns: '—', segments: '—', scenarios: '—' },
  { item: 'Comparison jobs', turn: 'separate records', turns: 'kept as records', segments: 'kept as records', scenarios: 'never modify any session' },
];
