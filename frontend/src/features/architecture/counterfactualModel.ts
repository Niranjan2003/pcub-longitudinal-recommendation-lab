/**
 * Counterfactual evaluation stages (explanation only). Grounded in MASTER_SYSTEM_REPORT §13-18.
 */
export interface Stage {
  id: string;
  title: string;
  text: string;
  synthetic?: boolean;
}

export const STAGES: Stage[] = [
  {
    id: 'root',
    title: 'Factual pending root',
    text: 'A comparison starts from a pending recommendation: the completed history, current state and position. It is pinned to the session’s revision. Both policies recompute their own root action from this same root.',
  },
  {
    id: 'forest',
    title: 'Paired two-depth forest (20 nodes)',
    text: 'Four possible first reactions, and under each the four possible second reactions: 4 + 16 = 20 hypothetical nodes. Every node pairs both policies: their next recipes, probabilities and utilities under the same reaction path.',
  },
  {
    id: 'prepare',
    title: 'Preparation pass',
    text: 'Before any budget applies, the backend prepares the full observable 20-node forest so that every decision the evaluation might need is fixed in advance. In live mode this step could involve provider work; offline it reads recorded decisions only.',
  },
  {
    id: 'allocator',
    title: 'Allocator chooses the frontier',
    text: 'The evaluation begins with the four first-reaction nodes as its frontier. The allocator picks which frontier node to expand next — never which recipe to recommend. Branch probabilities come from the frozen population predictor.',
  },
  {
    id: 'expand',
    title: 'Budget-limited expansion',
    text: 'Expansion continues until the budget (2, 4, 8 or 12) is used. In every tested run the number of expanded nodes equalled the budget. Unexpanded nodes contribute nothing and get no estimate.',
  },
  {
    id: 'estimate',
    title: 'Limited policy estimates',
    text: 'For each policy the backend averages engineered utility over the visited probability mass at each depth and sums the depths visited. These are cheap approximations, not unbiased expectations, and not comparable across budgets.',
  },
  {
    id: 'select',
    title: 'Selected policy',
    text: 'The policy with the larger limited estimate is selected. This is an engineering outcome inside the simulation for this one root; it does not change the session’s policy and says nothing general.',
  },
  {
    id: 'private',
    title: 'Private simulator probabilities',
    synthetic: true,
    text: 'Synthetic sessions only. The simulator’s private reaction probabilities — hidden from policies, predictors and allocators — become available to the oracle alone.',
  },
  {
    id: 'oracle',
    title: 'Exhaustive synthetic oracle',
    synthetic: true,
    text: 'The oracle enumerates all 20 nodes for both policies with those private probabilities, independently of the allocator and budget, and reports each policy’s reference value. It is simulator-relative, never human ground truth.',
  },
  {
    id: 'metrics',
    title: 'Regret and returned metrics',
    synthetic: true,
    text: 'Regret = oracle-best value minus the oracle value of the selected policy. The backend also returns best-policy correctness, rank agreement, value errors and visitation counts. One comparison is one case.',
  },
];
