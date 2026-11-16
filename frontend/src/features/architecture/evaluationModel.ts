/**
 * Evaluation map: ONLY mechanisms that are implemented and supported now. Static documentation.
 */
export type Avail = 'yes' | 'no' | 'aggregate';

export interface Mechanism {
  id: string;
  title: string;
  tone: 'pending' | 'human' | 'synthetic' | 'hypothetical' | 'oracle' | 'archive' | 'neutral';
  compares: string;
  produced: string;
  human: Avail;
  synthetic: Avail;
  r1: Avail;
  r1Note?: string;
  where: { to: string; label: string };
  notEstablished: string;
}

export const MECHANISMS: Mechanism[] = [
  {
    id: 'forecast',
    title: 'Pre-outcome reaction forecast',
    tone: 'pending',
    compares: 'Four reaction probabilities from observable, pre-reaction information, saved before the outcome; conformal reference sets alongside.',
    produced: 'User Behavior Prediction Agent (population, class-bias or contextual predictor).',
    human: 'yes',
    synthetic: 'yes',
    r1: 'no',
    where: { to: '/lab', label: 'Session: Forecast panel' },
    notEstablished: 'Forecast accuracy for real people. Conformal sets are frozen synthetic diagnostics with no human coverage guarantee.',
  },
  {
    id: 'realized',
    title: 'Realized reaction evidence',
    tone: 'human',
    compares: 'The forecast saved before the reveal, side by side with the reaction that was actually submitted or generated.',
    produced: 'Human structured feedback, or the independent synthetic simulator; committed by the orchestrator.',
    human: 'yes',
    synthetic: 'yes',
    r1: 'aggregate',
    r1Note: 'Reaction and continuation counts in longitudinal_metrics.',
    where: { to: '/lab', label: 'Session: Forecast vs Realized' },
    notEstablished: 'A human study or validated behaviour. Synthetic reactions are simulator behaviour. No accuracy score is computed.',
  },
  {
    id: 'longitudinal',
    title: 'Longitudinal state and history evolution',
    tone: 'neutral',
    compares: 'How history, the six engineered state variables and requested changes evolve turn by turn and across segments.',
    produced: 'Longitudinal Memory Manager (fixed transition rule).',
    human: 'yes',
    synthetic: 'yes',
    r1: 'aggregate',
    r1Note: 'Per-policy longitudinal aggregates in longitudinal_metrics.',
    where: { to: '/lab', label: 'Session: Timeline and Engineered state' },
    notEstablished: 'Psychological measurement. Continuity is within a scenario; nothing transfers between scenarios.',
  },
  {
    id: 'adaptation',
    title: 'Adaptive vs population predictor',
    tone: 'pending',
    compares: 'The returned adapted forecast (class-bias / contextual) beside the returned frozen population vector for the same turn.',
    produced: 'User Behavior Prediction Agent; both vectors are returned by the backend.',
    human: 'yes',
    synthetic: 'yes',
    r1: 'no',
    where: { to: '/lab', label: 'Session: Adaptation lens' },
    notEstablished: 'That adaptation improves prediction. No predictive score is computed or shown.',
  },
  {
    id: 'estimates',
    title: 'Branch limited estimates',
    tone: 'hypothetical',
    compares: 'Two policies’ visited-mass value estimates over a budget-limited hypothetical forest from the same pending root; the larger is selected.',
    produced: 'Counterfactual Evaluation Agent (branch engine + allocator), population predictor only.',
    human: 'yes',
    synthetic: 'yes',
    r1: 'no',
    where: { to: '/lab', label: 'Comparison: Limited policy estimates' },
    notEstablished: 'Unbiased expected value, comparability across budgets, or which food is better for anyone.',
  },
  {
    id: 'oracle',
    title: 'Synthetic oracle comparison',
    tone: 'oracle',
    compares: 'Each policy’s exhaustive value over all 20 nodes using the simulator’s private probabilities.',
    produced: 'Exhaustive synthetic oracle (Counterfactual Evaluation Agent), synthetic sessions only.',
    human: 'no',
    synthetic: 'yes',
    r1: 'aggregate',
    r1Note: 'Mean expected oracle policy values in primary_comparison.',
    where: { to: '/lab', label: 'Comparison: Synthetic oracle' },
    notEstablished: 'Human ground truth. No human oracle exists; human comparisons report it as absent.',
  },
  {
    id: 'metrics',
    title: 'Regret and returned comparison metrics',
    tone: 'oracle',
    compares: 'Regret of the selected policy, best-policy correctness, rank agreement, value errors, oracle margin and visitation counts, as returned.',
    produced: 'Backend comparison metrics, computed only when the oracle ran.',
    human: 'no',
    synthetic: 'yes',
    r1: 'aggregate',
    r1Note: 'Mean regret by allocator in branch_metrics.',
    where: { to: '/lab', label: 'Comparison: Evaluation metrics' },
    notEstablished: 'A general allocator ranking: one comparison is one case. R1 did not establish strict PCUB superiority.',
  },
  {
    id: 'accounting',
    title: 'Provider and replay accounting',
    tone: 'neutral',
    compares: 'Logical engine counters versus provider work (preparation, evaluation, combined) and cached/recorded reuse.',
    produced: 'Session orchestrator, comparison costs and (live mode only) the provider journal.',
    human: 'yes',
    synthetic: 'yes',
    r1: 'aggregate',
    r1Note: 'llm_accounting and replay_record tables.',
    where: { to: '/lab', label: 'Comparison: Cost ledger' },
    notEstablished: 'Monetary cost. Offline, provider counts are zero; unknown values are shown as unknown, never zero.',
  },
  {
    id: 'r1',
    title: 'Frozen historical R1 results',
    tone: 'archive',
    compares: 'Registered research questions RQ1–RQ4 over the historical experiment, as frozen aggregate tables.',
    produced: 'Read-only archive endpoint; never updated by this application.',
    human: 'no',
    synthetic: 'no',
    r1: 'yes',
    where: { to: '/r1', label: 'R1 archive' },
    notEstablished: 'A positive guarded-LLM gain (RQ1 negative), utility from higher sensitivity (RQ2), strict PCUB superiority (RQ3), or formal R1 closure.',
  },
];
