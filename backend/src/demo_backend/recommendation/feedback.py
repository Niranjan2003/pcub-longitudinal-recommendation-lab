from __future__ import annotations
from dataclasses import dataclass
import re
from demo_backend.recommendation.deterministic import _constraint_violations
from demo_backend.ports.recommendation import RecommendationContext
from demo_backend.domain.platform import RecommendationAgentOutput
from demo_backend.catalog.health import normalized_health_score
from demo_backend.safety.attributes import structured_recipe_constraint_evidence

POLICY_ID = 'feedback_sequence_recipe_recommendation'

class NoSafeRecommendation(ValueError):
    """Explicit clarification outcome: no verified candidate satisfies hard constraints."""

@dataclass(frozen=True)
class PseudoInteraction:
    recipe_id: str
    ingredients: tuple[str, ...]
    reaction: str

def tokens(ingredients):
    return {t for text in ingredients for t in re.findall('[a-z]+', text.lower()) if len(t) > 2}

def similarity(left, right):
    a, b = (tokens(left), tokens(right))
    return len(a & b) / len(a | b) if a | b else 0.0

def effort(recipe):
    return min(recipe.total_time_minutes / 60.0, 1.0) if recipe.total_time_minutes is not None else 1.0

def pseudo_history(context):
    """Observable past records only; no current outcome or hidden goal accepted."""
    history = context.memory_context.get('observable_history', ())
    result = []
    for entry in history:
        item = entry.action.selected_item
        if item is not None and entry.reaction is not None:
            result.append(PseudoInteraction(item.item_id, tuple(item.ingredients), entry.reaction.value))
    if not history:
        by_id = {r.recipe_id: r for r in context.recipes}
        for key, reaction in (('accepted_recipe_ids', 'ACCEPT'), ('rejected_recipe_ids', 'REJECT')):
            for item_id in context.memory_context.get(key, ()):
                if item_id in by_id:
                    result.append(PseudoInteraction(item_id, tuple(by_id[item_id].ingredients), reaction))
    return tuple(result)

def score_components(context, recipe):
    health = float(normalized_health_score(recipe) or 0.0)
    text = ' '.join((recipe.title, *recipe.ingredients, *recipe.tags)).lower()
    tastes = context.persona.taste_preferences
    taste = sum((t.lower() in text for t in tastes)) / max(1, len(tastes))
    recent = context.memory_context.get('recent_recipe_ids', ())
    feedback = [] if context.memory_context.get('observable_history') else list(context.memory_context.get('recent_preference_feedback', ()))
    for entry in context.memory_context.get('observable_history', ()):
        for change in entry.requested_changes:
            feedback.extend(('requested_change:' + d.value for d in change.dimensions))
    effort_requests = min(3, sum((x == 'requested_change:effort' for x in feedback)))
    health_requests = min(3, sum((x == 'requested_change:health' for x in feedback)))
    novelty_requests = min(3, sum((x == 'requested_change:novelty' for x in feedback)))
    novelty = float(context.memory_context.get('observable_novelty_preference', 0.5))
    if not 0 <= novelty <= 1:
        raise ValueError('observable novelty preference must be bounded')
    history = pseudo_history(context)
    reinforcement = 0.0
    for index, event in enumerate(history):
        signed = 1.0 if event.reaction == 'ACCEPT' else -1.0 if event.reaction == 'REJECT' else 0.0
        sim = 1.0 if event.recipe_id == recipe.recipe_id else similarity(event.ingredients, recipe.ingredients)
        reinforcement += signed * 0.8 ** (len(history) - 1 - index) * sim
    return {'health': (1.0 + 0.35 * health_requests) * health, 'taste': 0.6 * taste, 'effort': -(0.25 + 1.5 * context.state.fatigue + 0.45 * effort_requests) * effort(recipe), 'pseudo_interaction_history': 0.8 * reinforcement, 'repetition': -(0.3 + 0.6 * novelty + 0.2 * novelty_requests) * min(3, recent.count(recipe.recipe_id))}

class FeedbackSequencePolicy:
    policy_id = POLICY_ID
    policy_version = '1'
    deterministic = True

    def recommend(self, context: RecommendationContext):
        exclusions = context.memory_context.get('hard_excluded_ingredients', ())
        persona = context.persona.model_copy(update={'excluded_ingredients': list(dict.fromkeys([*context.persona.excluded_ingredients, *exclusions]))})
        candidates = []
        for recipe in context.recipes:
            if _constraint_violations(persona, recipe):
                continue
            if (persona.allergies or persona.excluded_ingredients or persona.dietary_pattern != 'omnivore') and (not recipe.ingredients):
                continue
            parts = score_components(context, recipe)
            candidates.append((sum(parts.values()), recipe, parts))
        if not candidates:
            raise NoSafeRecommendation('No verified candidate satisfies all hard constraints; clarify or expand the candidate pool.')
        candidates.sort(key=lambda item: (-item[0], item[1].recipe_id))
        _, selected, parts = candidates[0]
        return RecommendationAgentOutput(turn_index=context.turn_index, selected_recipe_id=selected.recipe_id, ranked_recipe_ids=[r.recipe_id for _, r, _ in candidates], rationale='CESRec-inspired signed pseudo-interaction history; interpretable contributions: ' + str(parts), constraint_violations=[], constraint_evidence=structured_recipe_constraint_evidence(persona, selected))
