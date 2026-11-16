from __future__ import annotations
from dataclasses import dataclass
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.simulation.structured import PCUBOutcomeContext
from demo_backend.simulation.structured import PCUBSyntheticOutcomeGenerator
from demo_backend.branching.engine import POLICY_IDENTITIES
from demo_backend.branching.engine import BranchSimulator
from demo_backend.branching.engine import PreparedRoot
from demo_backend.branching.engine import _position_after

@dataclass(frozen=True)
class OracleResult:
    policy_values: dict[str, float]
    best_policy: str
    exact_tie: bool
    hidden_probability_tree: tuple[dict, ...]

class ExhaustiveSyntheticOracle:
    """Full depth-2 evaluator isolated from allocator-facing contracts."""

    def __init__(self, simulator: BranchSimulator | None, *, policy_identities=POLICY_IDENTITIES, generator=None, private_profile, private_scenario):
        self.policy_identities = tuple(policy_identities)
        self.simulator = simulator
        self.generator = generator or PCUBSyntheticOutcomeGenerator()
        self.private_profile = private_profile
        self.private_scenario = private_scenario

    def _probabilities(self, prepared, snapshot, action, position) -> dict:
        item_id = action.selected_item.item_id if action.selected_item else None
        recipe = next((item for item in prepared.root.recipes if item.recipe_id == item_id))
        outcome = self.generator.generate(PCUBOutcomeContext(profile=self.private_profile, scenario=self.private_scenario, position=position, selected_recipe=recipe, constraint_violations=action.selected_item.known_constraints if action.selected_item else (), state_before=snapshot.state, history=snapshot.history, recent_recipe_ids=snapshot.recent_recipe_ids))
        if outcome.outcome_probabilities is None:
            raise ValueError('synthetic oracle outcome omitted reference probabilities')
        return {reaction.value: probability for reaction, probability in outcome.outcome_probabilities.as_mapping().items()}

    def evaluate(self, prepared: PreparedRoot) -> OracleResult:
        root = prepared.root
        values: dict[str, float] = {}
        hidden: list[dict] = []
        root_position = root.predictor_input.position
        depth_two_position = _position_after(root_position, root)
        depth_three_position = _position_after(depth_two_position, root)
        for policy_index, policy_identity in enumerate(self.policy_identities):
            policy_id = policy_identity[0]
            root_snapshot = prepared.snapshots[policy_index]
            root_action = prepared.actions[policy_index]
            probabilities_one = self._probabilities(prepared, root_snapshot, root_action, root_position)
            policy_value = 0.0
            hidden.append({'policy_id': policy_id, 'branch_path': [], 'authoritative_synthetic_probabilities': probabilities_one})
            for reaction_one in RESEARCH_REACTION_ORDER:
                branch_one = f'{root.root_context_id}:oracle:{policy_id}:{reaction_one.value}'
                snapshot_one = self.simulator.apply_reaction(root_snapshot, root_action, reaction_one, root_position, branch_id=branch_one)
                action_one, recipe_one = self.simulator.recommend(root, snapshot_one, policy_identity, depth_two_position, action_suffix=f'oracle-d1-{reaction_one.value}')
                utility_one = self.simulator.utility(snapshot_one.state, action_one, recipe_one).synthetic_branch_utility
                probabilities_two = self._probabilities(prepared, snapshot_one, action_one, depth_two_position)
                hidden.append({'policy_id': policy_id, 'branch_path': [reaction_one.value], 'authoritative_synthetic_probabilities': probabilities_two})
                expected_two = 0.0
                for reaction_two in RESEARCH_REACTION_ORDER:
                    branch_two = f'{branch_one}>{reaction_two.value}'
                    snapshot_two = self.simulator.apply_reaction(snapshot_one, action_one, reaction_two, depth_two_position, branch_id=branch_two)
                    action_two, recipe_two = self.simulator.recommend(root, snapshot_two, policy_identity, depth_three_position, action_suffix=f'oracle-d2-{reaction_one.value}-{reaction_two.value}')
                    utility_two = self.simulator.utility(snapshot_two.state, action_two, recipe_two).synthetic_branch_utility
                    expected_two += probabilities_two[reaction_two.value] * utility_two
                policy_value += probabilities_one[reaction_one.value] * (utility_one + expected_two)
            values[policy_id] = float(policy_value)
        ordered = [item[0] for item in self.policy_identities]
        exact_tie = abs(values[ordered[0]] - values[ordered[1]]) <= 1e-12
        best = max(ordered, key=lambda item: (values[item], -ordered.index(item)))
        return OracleResult(policy_values=values, best_policy=best, exact_tie=exact_tie, hidden_probability_tree=tuple(hidden))
