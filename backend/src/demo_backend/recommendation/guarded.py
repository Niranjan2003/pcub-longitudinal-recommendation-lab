from __future__ import annotations
import hashlib
import time
from datetime import datetime
from datetime import timezone
from typing import Annotated
from typing import Literal
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import ValidationError
from demo_backend.ports.errors import LLMClientError
from demo_backend.recommendation.json_extract import extract_json_object
from demo_backend.domain.platform import RecommendationAgentOutput
from demo_backend.safety.attributes import structured_recipe_constraint_evidence
from demo_backend.ports.errors import BudgetExceeded
from demo_backend.ports.errors import DecisionIntegrityError
from demo_backend.recommendation.usage import usage_values
from demo_backend.recommendation.prompt import SYSTEM_PROMPT as V1_SYSTEM_PROMPT
from demo_backend.recommendation.prompt import build_context
from demo_backend.recommendation.prompt import canonical
from demo_backend.recommendation.guard_contracts import InvalidDecision
from demo_backend.recommendation.guard_contracts import LiveSettings
from demo_backend.recommendation.guard_contracts import ReasonCode
from demo_backend.recommendation.shortlist import shortlist

POLICY_ID = 'guarded_llm_score_vector'

CONTRACT_VERSION = 'guarded_llm_score_vector@1'

PROMPT_VERSION = 'guarded_llm_rerank_prompt_v2'

Score = Annotated[int, Field(strict=True, ge=0, le=100)]

class GuardedScoreDecision(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)
    candidate_scores: list[Score] = Field(min_length=1, max_length=10)
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=10)
    tradeoff_summary: str = Field(min_length=1, max_length=400)

class ScoreSettings(LiveSettings):
    decision_contract_version: Literal['guarded_llm_score_vector@1'] = CONTRACT_VERSION
    prompt_version: Literal['guarded_llm_rerank_prompt_v2'] = PROMPT_VERSION
    response_format: Literal['json_schema'] = 'json_schema'
    client_version: str = 'v3_bounded_score_vector_transport_v1'

SYSTEM_PROMPT = V1_SYSTEM_PROMPT.replace('Rank only the supplied safe recipe IDs. Return every candidate exactly once, selected_recipe_id first.', 'Assign one integer preference score (0 to 100) to every safe candidate POSITION, in the supplied canonical order.\nReturn candidate_scores in position order, never recipe IDs or a ranked-ID list. Equal scores are allowed.\n0-20: very poor soft fit; 21-40: poor fit; 41-60: acceptable; 61-80: good fit; 81-100: very strong fit.\nScores are NOT probabilities and do not need to sum to 100. The application maps positions to recipes,\nsorts scores descending and resolves exact ties by recipe ID ascending.')

def positioned_context(context, candidates):
    observed = build_context(context, candidates)
    return observed.model_copy(update={'candidates': [{**candidate, 'position': index} for index, candidate in enumerate(observed.candidates)]})

def native_schema(count):
    if not 1 <= count <= 10:
        raise ValueError('Shortlist length must be between 1 and 10')
    schema = GuardedScoreDecision.model_json_schema()
    schema['properties']['candidate_scores'].update({'minItems': count, 'maxItems': count})
    return schema

def prompt_sha256():
    return hashlib.sha256((CONTRACT_VERSION + PROMPT_VERSION + SYSTEM_PROMPT + canonical(GuardedScoreDecision.model_json_schema())).encode()).hexdigest()

def prompt(context):
    return SYSTEM_PROMPT + '\nRequired JSON schema:\n' + canonical(native_schema(len(context.candidates))) + '\nUNTRUSTED_DATA_JSON:\n' + canonical(context.model_dump(mode='json'))

def decision_input(context, settings, fallback):
    mapping = [{'position': i, 'recipe_id': recipe['recipe_id']} for i, recipe in enumerate(context.candidates)]
    value = {'decision_contract_version': CONTRACT_VERSION, 'prompt_version': PROMPT_VERSION, 'prompt_sha256': prompt_sha256(), 'settings': settings.model_dump(mode='json'), 'shortlist': 'v3_safe_shortlist@1', 'observable_context': context.model_dump(mode='json'), 'candidate_position_mapping': mapping, 'fallback_ranking_sha256': hashlib.sha256(canonical(fallback.ranked_recipe_ids).encode()).hexdigest()}
    return (hashlib.sha256(canonical(value).encode()).hexdigest(), value)

def derive_ranking(decision, candidates):
    if len(decision.candidate_scores) != len(candidates):
        raise InvalidDecision('score_vector_length')
    ids = [candidate['recipe_id'] for candidate in candidates]
    if ids != sorted(set(ids)):
        raise ValueError('Candidate mapping must use unique canonical recipe-ID order')
    return [recipe_id for score, recipe_id in sorted(zip(decision.candidate_scores, ids), key=lambda item: (-item[0], item[1]))]

def score_once(client, store, key, input_value, context, settings, fallback):
    cached = store.get(key)
    if cached is not None:
        if cached.get('decision_contract_version') != CONTRACT_VERSION:
            raise DecisionIntegrityError('Wrong cached decision contract')
        return (cached, True)
    store.reserve(key)
    raw = ''
    decision = None
    ranking = None
    reason = None
    started = time.perf_counter()
    try:
        raw = client.generate_text(prompt(context))
        if not isinstance(raw, str) or len(raw) > 24000:
            raise InvalidDecision('output_limit')
        try:
            parsed = extract_json_object(raw)
        except Exception as exc:
            raise InvalidDecision('invalid_json') from exc
        try:
            decision = GuardedScoreDecision.model_validate_json(canonical(parsed))
        except ValidationError as exc:
            raise InvalidDecision('schema_error') from exc
        ranking = derive_ranking(decision, context.candidates)
    except BudgetExceeded:
        raise
    except InvalidDecision as exc:
        reason = exc.reason
        decision = None
    except TimeoutError:
        reason = 'transport_timeout'
    except Exception as exc:
        if isinstance(exc, LLMClientError) and exc.diagnostic_category == 'call_limit_exceeded':
            raise BudgetExceeded('Provider call limit exhausted') from exc
        reason = 'transport_timeout' if 'timeout' in type(exc).__name__.lower() else 'provider_error'
    record = {'version': 'guarded_score_vector_decision_record_v1', 'decision_contract_version': CONTRACT_VERSION, 'input': input_value, 'prompt_version': PROMPT_VERSION, 'prompt_sha256': prompt_sha256(), 'provider': settings.provider, 'requested_model': settings.model, 'response_model': getattr(client, 'last_response_model', None), 'decoding': settings.model_dump(mode='json'), 'timestamp': datetime.now(timezone.utc).isoformat(), 'attempt_count': 1, 'latency_ms': (time.perf_counter() - started) * 1000, 'usage': usage_values(client), 'raw_response_sha256': hashlib.sha256(raw.encode()).hexdigest(), 'candidate_position_mapping': input_value['candidate_position_mapping'], 'decision': decision.model_dump(mode='json') if decision else None, 'raw_score_vector': decision.candidate_scores if decision else None, 'derived_ranking': ranking if decision else None, 'derived_top1': ranking[0] if decision else None, 'fallback': reason is not None, 'fallback_reason': reason, 'scientific_ranking': fallback.ranked_recipe_ids if reason else ranking, 'selected_recipe_id': fallback.selected_recipe_id if reason else ranking[0]}
    return (store.put(key, record), False)

class GuardedScoreVectorPolicy:
    policy_id = POLICY_ID
    policy_version = '1'
    deterministic = False

    def __init__(self, client, store, settings):
        self.client = client
        self.store = store
        self.settings = settings
        self.events = []

    def recommend(self, context):
        safe, candidates, fallback = shortlist(context)
        observed = positioned_context(safe, candidates)
        key, input_value = decision_input(observed, self.settings, fallback)
        record, replayed = score_once(self.client, self.store, key, input_value, observed, self.settings, fallback)
        selected = record['selected_recipe_id']
        recipe = next((r for r in safe.recipes if r.recipe_id == selected))
        self.events.append({'decision_sha256': key, 'cache_replay': replayed, 'fallback': record['fallback'], 'fallback_reason': record['fallback_reason']})
        return RecommendationAgentOutput(turn_index=context.turn_index, selected_recipe_id=selected, ranked_recipe_ids=record['scientific_ranking'], constraint_violations=[], constraint_evidence=structured_recipe_constraint_evidence(safe.persona, recipe), rationale=CONTRACT_VERSION + ' decision_sha256=' + key + ' fallback=' + str(record['fallback']) + '; explanation has no outcome/state authority')
