from __future__ import annotations
import math
from collections import Counter
from dataclasses import dataclass
import numpy as np
from demo_backend.recommendation.baselines import CONSTRAINT_ONLY_POLICY_ID
from demo_backend.recommendation.baselines import CONSTRAINT_ONLY_POLICY_VERSION
from demo_backend.recommendation.baselines import DEFAULT_RECOMMENDATION_POLICY_ID
from demo_backend.recommendation.baselines import DEFAULT_RECOMMENDATION_POLICY_VERSION
from demo_backend.domain.platform import DynamicUserState
from demo_backend.domain.platform import RecipeItem
from demo_backend.catalog.health import normalized_health_score
from demo_backend.domain.ontology import RESEARCH_REACTION_ORDER
from demo_backend.domain.ontology import ResearchContinuation
from demo_backend.domain.ontology import ResearchReaction
from demo_backend.domain.research import AuthoritativeOutcome
from demo_backend.domain.research import HistoryEntry
from demo_backend.domain.research import Position
from demo_backend.domain.research import RecommenderAction
from demo_backend.domain.research import RequestedChange
from demo_backend.domain.research import ResearchInitialState
from demo_backend.domain.research import SampleProvenance
from demo_backend.domain.research import VersionedReference
from demo_backend.simulation.transition import PCUBSyntheticStateTransition
from demo_backend.domain.versions import BRANCH_ENGINE_VERSION
from demo_backend.domain.versions import BRANCH_PREDICTOR_VERSION
from demo_backend.domain.versions import BRANCH_UTILITY_VERSION
from demo_backend.domain.versions import SEED_DERIVATION_VERSION
from demo_backend.domain.versions import TRANSITION_POLICY_VERSION
from demo_backend.branching.contracts import BranchNode
from demo_backend.branching.contracts import BranchRunResult
from demo_backend.branching.contracts import BranchSnapshot
from demo_backend.branching.contracts import ExpansionCost
from demo_backend.branching.contracts import FrontierCandidate
from demo_backend.branching.contracts import PolicyBranchEvidence
from demo_backend.branching.contracts import UtilityComponents
from demo_backend.ports.prediction import FrozenCalibratedBranchPredictor
from demo_backend.domain.roots import RootContext

POLICY_IDENTITIES = ((DEFAULT_RECOMMENDATION_POLICY_ID, DEFAULT_RECOMMENDATION_POLICY_VERSION), (CONSTRAINT_ONLY_POLICY_ID, CONSTRAINT_ONLY_POLICY_VERSION))

MAX_BRANCH_DEPTH = 2

REACTION_SENSITIVITY = {ResearchReaction.ACCEPT: 0.2, ResearchReaction.MODIFY_CLARIFY: 0.6, ResearchReaction.DEFER: 0.4, ResearchReaction.REJECT: 1.0}

@dataclass(frozen=True)
class PreparedRoot:
    root: RootContext
    snapshots: tuple[BranchSnapshot, BranchSnapshot]
    actions: tuple[RecommenderAction, RecommenderAction]
    probabilities: tuple[tuple[float, ...], tuple[float, ...]]

@dataclass(frozen=True)
class InternalNodeState:
    snapshots: tuple[BranchSnapshot, BranchSnapshot]
    actions: tuple[RecommenderAction, RecommenderAction]
    cumulative_probabilities: tuple[float, float]

@dataclass(frozen=True)
class AlternativeStateUtility:
    """Prespecified RQ4 diagnostic weights; the primary utility remains unchanged."""
    identifier: str
    satisfaction: float
    engagement: float
    trust: float
    motivation: float
    inverse_resistance: float
    inverse_fatigue: float

    def __post_init__(self):
        weights = (self.satisfaction, self.engagement, self.trust, self.motivation, self.inverse_resistance, self.inverse_fatigue)
        if any((not math.isfinite(value) or value < 0.0 for value in weights)):
            raise ValueError('alternative state-utility weights must be finite and nonnegative')
        if not math.isclose(sum(weights), 1.0, abs_tol=1e-12):
            raise ValueError('alternative state-utility weights must sum to one')

    def state_component(self, state: ResearchInitialState) -> float:
        return self.satisfaction * state.satisfaction + self.engagement * state.engagement + self.trust * state.trust + self.motivation * state.motivation + self.inverse_resistance * (1.0 - state.resistance) + self.inverse_fatigue * (1.0 - state.fatigue)

def _dynamic_state(state: ResearchInitialState) -> DynamicUserState:
    return DynamicUserState(**state.model_dump(mode='python', exclude={'specification_version'}))

def _state_from_input(root: RootContext) -> ResearchInitialState:
    if root.state_snapshot is not None:
        return root.state_snapshot.model_copy(deep=True)
    values = {feature.feature_specification.identifier.rsplit('.', 1)[-1]: float(feature.value) for feature in root.predictor_input.features if feature.feature_specification.identifier.startswith('dynamic_state.')}
    required = {'trust', 'motivation', 'fatigue', 'satisfaction', 'engagement', 'resistance'}
    if set(values) != required:
        raise ValueError('root predictor input lacks a complete dynamic-state snapshot')
    return ResearchInitialState(**values)

def _base_snapshot(root: RootContext, policy_id: str) -> BranchSnapshot:
    history = root.predictor_input.history
    recent = tuple((entry.action.selected_item.item_id for entry in history if entry.action.selected_item is not None))
    accepted = tuple((entry.action.selected_item.item_id for entry in history if entry.reaction == ResearchReaction.ACCEPT and entry.action.selected_item is not None))
    rejected = tuple((entry.action.selected_item.item_id for entry in history if entry.reaction == ResearchReaction.REJECT and entry.action.selected_item is not None))
    feedback = tuple((f'requested_change:{dimension.value}' for entry in history for change in entry.requested_changes for dimension in change.dimensions))
    return BranchSnapshot(state=_state_from_input(root), history=history, recent_recipe_ids=recent, accepted_recipe_ids=accepted, rejected_recipe_ids=rejected, recent_preference_feedback=feedback, rng_namespace=f'{root.root_context_id}:{policy_id}:branch')

def _position_after(position: Position, root: RootContext) -> Position:
    plan = root.scenario.session_plan
    if position.turn_index < plan.turns_per_session:
        return Position(session_index=position.session_index, turn_index=position.turn_index + 1)
    if position.session_index < plan.number_of_sessions:
        return Position(session_index=position.session_index + 1, turn_index=1)
    raise ValueError('branch would exceed the frozen scenario horizon')

def _position_ordinal(position: Position, root: RootContext) -> int:
    return (position.session_index - 1) * root.scenario.session_plan.turns_per_session + position.turn_index

def _history_summary(history: tuple[HistoryEntry, ...]) -> tuple[str, ...]:
    return tuple((f"s{item.position.session_index}:t{item.position.turn_index}:{(item.reaction.value if item.reaction else 'MISSING')}" for item in history))

def _action_disagreement(actions: tuple[RecommenderAction, RecommenderAction]) -> float:
    left, right = actions
    if left.selected_item is None or right.selected_item is None:
        return float(left.selected_item != right.selected_item)
    if left.selected_item.item_id == right.selected_item.item_id:
        return 0.0
    a, b = (set(left.selected_item.ingredients), set(right.selected_item.ingredients))
    union = a | b
    jaccard_distance = 1.0 - (len(a & b) / len(union) if union else 1.0)
    return min(1.0, 0.5 + 0.5 * jaccard_distance)

def _entropy_contribution(probability: float) -> float:
    if probability <= 0.0:
        return 0.0
    maximum = 1.0 / (math.e * math.log(len(RESEARCH_REACTION_ORDER)))
    return min(1.0, -probability * math.log(probability) / math.log(4.0) / maximum)

BRANCH_ENGINE_VERSION = 'pcub_v2_paired_branch_engine_v1'

BRANCH_PREDICTOR_VERSION = 'pcub_v2_catalog_population_branch_predictor_v1'

class BranchSimulator:
    """Pure in-memory branch transitions and recommendations; no writes or RNG."""
    engine_version = BRANCH_ENGINE_VERSION

    def __init__(self, alternative_state_utility: AlternativeStateUtility | None=None):
        self.transition = PCUBSyntheticStateTransition()
        self.alternative_state_utility = alternative_state_utility

    def apply_reaction(self, snapshot: BranchSnapshot, current_action: RecommenderAction, reaction: ResearchReaction, position: Position, *, branch_id: str) -> BranchSnapshot:
        outcome = AuthoritativeOutcome(reaction=reaction, continuation=ResearchContinuation.CONTINUE, requested_changes=(RequestedChange(residual_text='Hypothetical clarification branch.'),) if reaction == ResearchReaction.MODIFY_CLARIFY else (), synthetic_reference=VersionedReference(identifier='pcub_hypothetical_reaction_branch', version=BRANCH_ENGINE_VERSION), sample_provenance=SampleProvenance(root_seed=0, simulation_seed_namespace=f'{snapshot.rng_namespace}:{branch_id}', seed_derivation_version=SEED_DERIVATION_VERSION), source_evidence_ids=(branch_id,))
        state_after = self.transition.apply(snapshot.state, outcome).state_after
        history_entry = HistoryEntry(position=position, action=current_action, reaction=reaction, continuation=ResearchContinuation.CONTINUE, requested_changes=outcome.requested_changes, source_evidence_ids=(branch_id,))
        selected_id = current_action.selected_item.item_id if current_action.selected_item is not None else None
        return BranchSnapshot(state=state_after, history=(*snapshot.history, history_entry), recent_recipe_ids=(*snapshot.recent_recipe_ids, selected_id) if selected_id is not None else snapshot.recent_recipe_ids, accepted_recipe_ids=(*snapshot.accepted_recipe_ids, selected_id) if selected_id is not None and reaction == ResearchReaction.ACCEPT else snapshot.accepted_recipe_ids, rejected_recipe_ids=(*snapshot.rejected_recipe_ids, selected_id) if selected_id is not None and reaction == ResearchReaction.REJECT else snapshot.rejected_recipe_ids, recent_preference_feedback=snapshot.recent_preference_feedback, rng_namespace=f'{snapshot.rng_namespace}:{reaction.value}')

    def utility(self, state: ResearchInitialState, action: RecommenderAction, recipe: RecipeItem) -> UtilityComponents:
        if self.alternative_state_utility is None:
            state_component = (state.satisfaction + state.engagement + state.trust + state.motivation + (1.0 - state.resistance) + (1.0 - state.fatigue)) / 6.0
        else:
            state_component = self.alternative_state_utility.state_component(state)
        normalized = normalized_health_score(recipe)
        health = float(0.5 if normalized is None else normalized)
        constraint_fit = 1.0 - min(len(action.selected_item.known_constraints if action.selected_item else ()) / 2.0, 1.0)
        action_component = 0.5 * health + 0.5 * constraint_fit
        total = 0.7 * state_component + 0.3 * action_component
        return UtilityComponents(state_component=float(state_component), action_component=float(action_component), synthetic_branch_utility=float(total))

class BranchEngine:
    version = BRANCH_ENGINE_VERSION

    def __init__(self, predictor: FrozenCalibratedBranchPredictor, simulator: BranchSimulator | None, policy_identities=POLICY_IDENTITIES):
        if len(policy_identities) != 2 or len(set(policy_identities)) != 2:
            raise ValueError('A V2 comparison must contain exactly two distinct policies')
        self.policy_identities = tuple(policy_identities)
        self.predictor = predictor
        self.simulator = simulator

    def prepare_root(self, root: RootContext) -> PreparedRoot:
        snapshots, actions, probabilities = ([], [], [])
        for policy_identity in self.policy_identities:
            snapshot = _base_snapshot(root, policy_identity[0])
            action, _ = self.simulator.recommend(root, snapshot, policy_identity, root.predictor_input.position, action_suffix='root')
            policy_ref = VersionedReference(identifier=policy_identity[0], version=policy_identity[1])
            prediction = self.predictor.predict(position=root.predictor_input.position, action=action, policy=policy_ref, profile_features=root.profile.characteristics, context=root.predictor_input.context, history=snapshot.history, state=snapshot.state, evidence_id=f'{root.root_context_id}:root-state')
            snapshots.append(snapshot)
            actions.append(action)
            probabilities.append(prediction)
        return PreparedRoot(root=root, snapshots=tuple(snapshots), actions=tuple(actions), probabilities=tuple(probabilities))

    def _candidates(self, *, prepared: PreparedRoot, parent_id: str | None, depth: int, branch_path: tuple[ResearchReaction, ...], policy_probabilities: tuple[tuple[float, ...], tuple[float, ...]], parent_cumulative: tuple[float, float], actions: tuple[RecommenderAction, RecommenderAction]) -> list[FrontierCandidate]:
        disagreement = _action_disagreement(actions)
        raw = []
        for index, reaction in enumerate(RESEARCH_REACTION_ORDER):
            step = tuple((policy_probabilities[p][index] for p in range(2)))
            cumulative = tuple((parent_cumulative[p] * step[p] for p in range(2)))
            mean_cumulative = float(np.mean(cumulative))
            mean_step = float(np.mean(step))
            path = (*branch_path, reaction)
            candidate_id = f'{prepared.root.root_context_id}:d{depth}:' + '>'.join((item.value for item in path))
            raw.append((candidate_id, reaction, step, cumulative, mean_cumulative, mean_step))
        return [FrontierCandidate(candidate_id=item[0], parent_node_id=parent_id, depth=depth, reaction=item[1], first_reaction=branch_path[0] if branch_path else item[1], policy_step_probabilities=item[2], policy_cumulative_probabilities=item[3], probability_component=item[4], uncertainty_component=float(np.mean([_entropy_contribution(value) for value in item[2]])), disagreement_component=disagreement * REACTION_SENSITIVITY[item[1]], cost_component=1.0) for item in raw]

    def run(self, prepared: PreparedRoot, allocator, budget: int) -> BranchRunResult:
        if budget < 1:
            raise ValueError('branch expansion budget must be positive')
        if budget > 20:
            raise ValueError('V1 branch expansion budget cannot exceed 20')
        root = prepared.root
        frontier = self._candidates(prepared=prepared, parent_id=None, depth=1, branch_path=(), policy_probabilities=prepared.probabilities, parent_cumulative=(1.0, 1.0), actions=prepared.actions)
        internal: dict[str, InternalNodeState] = {}
        nodes: list[BranchNode] = []
        counts: Counter[str] = Counter()
        predictor_calls = 2
        recommender_calls = 2
        while frontier and len(nodes) < budget:
            candidate = allocator.select(tuple(frontier), counts)
            frontier.remove(candidate)
            if candidate.parent_node_id is None:
                parent_snapshots = prepared.snapshots
                current_actions = prepared.actions
                parent_path: tuple[ResearchReaction, ...] = ()
                current_position = root.predictor_input.position
            else:
                parent = internal[candidate.parent_node_id]
                parent_snapshots = parent.snapshots
                current_actions = parent.actions
                parent_node = next((node for node in nodes if node.node_id == candidate.parent_node_id))
                parent_path = parent_node.branch_path
                current_position = _position_after(root.predictor_input.position, root)
                if candidate.depth == 2:
                    current_position = _position_after(root.predictor_input.position, root)
            branch_path = (*parent_path, candidate.reaction)
            next_position = _position_after(current_position, root)
            child_snapshots, downstream_actions, evidence = ([], [], [])
            child_probabilities: list[tuple[float, ...]] = []
            for policy_index, policy_identity in enumerate(self.policy_identities):
                child = self.simulator.apply_reaction(parent_snapshots[policy_index], current_actions[policy_index], candidate.reaction, current_position, branch_id=candidate.candidate_id)
                action, recipe = self.simulator.recommend(root, child, policy_identity, next_position, action_suffix=f"d{candidate.depth}-{'-'.join((item.value for item in branch_path))}")
                recommender_calls += 1
                utility = self.simulator.utility(child.state, action, recipe)
                child_snapshots.append(child)
                downstream_actions.append(action)
                evidence.append(PolicyBranchEvidence(policy=VersionedReference(identifier=policy_identity[0], version=policy_identity[1]), calibrated_step_probability=candidate.policy_step_probabilities[policy_index], calibrated_cumulative_probability=candidate.policy_cumulative_probabilities[policy_index], downstream_action=action, utility=utility))
                if candidate.depth < MAX_BRANCH_DEPTH:
                    child_probabilities.append(self.predictor.predict(position=next_position, action=action, policy=evidence[-1].policy, profile_features=root.profile.characteristics, context=root.predictor_input.context, history=child.history, state=child.state, evidence_id=candidate.candidate_id))
                    predictor_calls += 1
            node = BranchNode(engine=VersionedReference(identifier='paired_v2_branch_engine', version=BRANCH_ENGINE_VERSION), node_id=candidate.candidate_id, parent_node_id=candidate.parent_node_id, depth=candidate.depth, profile_id=root.profile.profile_id, scenario_id=root.scenario.scenario_id, hypothetical_reaction=candidate.reaction, branch_path=branch_path, calibrated_reaction_probability=float(np.mean(candidate.policy_step_probabilities)), cumulative_path_probability=float(np.mean(candidate.policy_cumulative_probabilities)), cloned_dynamic_state=child_snapshots[0].state, permitted_history_summary=_history_summary(child_snapshots[0].history), policy_evidence=tuple(evidence), expansion_cost=ExpansionCost(predictor_calls=2 if candidate.depth < MAX_BRANCH_DEPTH else 0, recommender_calls=2), provenance=(VersionedReference(identifier='frozen_calibrated_population_predictor', version=BRANCH_PREDICTOR_VERSION), VersionedReference(identifier='pcub_synthetic_state_transition', version=TRANSITION_POLICY_VERSION), VersionedReference(identifier='synthetic_branch_utility', version=BRANCH_UTILITY_VERSION)))
            nodes.append(node)
            counts[candidate.first_reaction.value] += 1
            internal[node.node_id] = InternalNodeState(snapshots=tuple(child_snapshots), actions=tuple(downstream_actions), cumulative_probabilities=candidate.policy_cumulative_probabilities)
            if candidate.depth < MAX_BRANCH_DEPTH:
                frontier.extend(self._candidates(prepared=prepared, parent_id=node.node_id, depth=candidate.depth + 1, branch_path=branch_path, policy_probabilities=tuple(child_probabilities), parent_cumulative=candidate.policy_cumulative_probabilities, actions=tuple(downstream_actions)))
        if len(nodes) > budget:
            raise RuntimeError('allocator exceeded branch expansion budget')
        estimates = self._estimate_values(nodes)
        selected_policy = max((identity[0] for identity in self.policy_identities), key=lambda policy_id: (estimates[policy_id], -self._policy_index(policy_id)))
        selected_index = self._policy_index(selected_policy)
        return BranchRunResult(root_context_id=root.root_context_id, allocator_id=allocator.allocator_id, allocator_version=allocator.version, budget=budget, actual_expansions=len(nodes), predictor_calls=predictor_calls, recommender_calls=recommender_calls, expansion_order=tuple((node.node_id for node in nodes)), nodes=tuple(nodes), estimated_policy_values=estimates, selected_policy=selected_policy, selected_action=prepared.actions[selected_index])

    def _policy_index(self, policy_id: str) -> int:
        return next((index for index, item in enumerate(self.policy_identities) if item[0] == policy_id))

    def _estimate_values(self, nodes: list[BranchNode]) -> dict[str, float]:
        result = {}
        for policy_id, _ in self.policy_identities:
            depth_values = []
            for depth in (1, 2):
                weighted, mass = (0.0, 0.0)
                for node in nodes:
                    if node.depth != depth:
                        continue
                    evidence = next((item for item in node.policy_evidence if item.policy.identifier == policy_id))
                    weight = evidence.calibrated_cumulative_probability
                    weighted += weight * evidence.utility.synthetic_branch_utility
                    mass += weight
                if mass > 0.0:
                    depth_values.append(weighted / mass)
            result[policy_id] = float(sum(depth_values))
        return result
