#!/usr/bin/env python3
"""Controlled smoke check of the live guarded LLM path through the public HTTP API.

Standard library only. It talks to an already running backend that was started in live
mode, either the real one (scripts/start_live_backend.ps1) or the fake-provider harness
(scripts/fake_live_backend.py). It never starts a backend and never sees a credential.

Phases (run them in this order against one backend database and provider journal):

  first          Creates a guarded human session with a new, unique persona, so its
                 decision context cannot be in the recorded closure or the journal, and
                 asks for ONE recommendation. That is exactly one provider request. It then
                 checks the parsed decision, live_guarded provenance and the accounting,
                 replays the same command (idempotent: no new work), and creates a second,
                 identical session whose recommendation must reuse the journaled decision
                 with no new provider request.
  after-restart  After the operator restarts the backend with the same journal and
                 database: the first session is still stored, and a third identical
                 session again reuses the journaled decision with no provider request.
  budget         When the live-call limit is used up: a recommendation that would need a
                 new provider request is refused with PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE
                 and no reservation is added. Makes no provider request.

    python scripts/live_smoke.py --base-url http://127.0.0.1:8785 --expect real --phase first

--expect real refuses to run against the fake harness, and --expect fake refuses to run
against anything else. State shared between phases is kept in --state (JSON, no secrets).
Exit status 0 when every check passes, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

GUARDED = 'guarded_llm_score_vector'
FAKE = 'fake_in_process_test_double'
REQUEST = 'Recommend a quick dinner for a weeknight.'

failures: list[str] = []


def check(ok: bool, label: str, detail: object = '') -> bool:
    print(('  PASS ' if ok else '  FAIL ') + label + (f' ({detail})' if detail != '' else ''))
    if not ok:
        failures.append(label)
    return ok


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip('/')

    def call(self, method: str, path: str, body: dict | None = None, key: str | None = None):
        data = None if body is None else json.dumps(body).encode('utf-8')
        headers = {'Content-Type': 'application/json'} if body is not None else {}
        if key:
            headers['Idempotency-Key'] = key
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.status, json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))

    def ok(self, method: str, path: str, body: dict | None = None, key: str | None = None) -> dict:
        status, value = self.call(method, path, body, key)
        if status != 200:
            raise SystemExit(f'Unexpected HTTP {status} for {method} {path}: {value}')
        return value


def key(label: str) -> str:
    return f'smoke-{label}-{uuid.uuid4()}'


def persona(user_id: str) -> dict:
    return {'user_id': user_id, 'display_name': 'Live smoke test', 'dietary_pattern': 'omnivore', 'allergies': ['peanut'],
            'excluded_ingredients': [], 'health_goals': [], 'taste_preferences': ['savory']}


def create(api: Api, user_id: str) -> dict:
    body = {'world_kind': 'human_interaction', 'policy': GUARDED, 'prediction_backend': 'current_structured_simulator@1',
            'predictor': 'population', 'persona': persona(user_id), 'request': REQUEST, 'segments': 1, 'turns_per_segment': 2}
    return api.ok('POST', '/v1/sessions', body, key('create'))


def capabilities(api: Api, expect: str) -> dict:
    caps = api.ok('GET', '/v1/capabilities')
    check(caps.get('mode') == 'live_opt_in' and caps.get('live_guarded') is True, 'backend reports live mode', f"mode={caps.get('mode')}, live_guarded={caps.get('live_guarded')}")
    transport = caps.get('provider_transport')
    if expect == 'real' and transport is not None:
        raise SystemExit(f'Refusing: --expect real, but the backend reports provider_transport={transport!r}')
    if expect == 'fake' and transport != FAKE:
        raise SystemExit('Refusing: --expect fake, but this is not the fake-provider harness. Nothing was sent.')
    print(f"backend: mode {caps['mode']}, asset manifest {caps['asset_manifest_fingerprint'][:12]}..., transport {transport or 'real (not reported)'}")
    return caps


def journal_record(costs: dict, decision: str) -> dict | None:
    return next((r for r in costs.get('journal_after', {}).get('records', []) if r['key'] == decision), None)


def phase_first(api: Api, expect: str, state_path: Path) -> None:
    caps = capabilities(api, expect)
    fake_before = caps.get('fake_provider_calls')
    run = f"live-smoke-{time.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:6]}"
    print(f'\n[1] new guarded session for persona {run} (a context that cannot be recorded or journaled yet)')
    a = create(api, run)
    check(a['policy'] == GUARDED and a['revision'] == 0, 'session created with the guarded policy', a['id'])

    print('[2] one recommendation: expected to make exactly one provider request')
    recommend_key = key('recommend')
    started = time.perf_counter()
    status, after = api.call('POST', f"/v1/sessions/{a['id']}/recommendations", {'expected_revision': 0}, recommend_key)
    elapsed = time.perf_counter() - started
    if not check(status == 200, 'recommendation returned HTTP 200', f'HTTP {status}, {elapsed:.1f} s'):
        print('  response:', json.dumps(after)[:600])
        return
    pending = after['pending']
    costs = pending['provider_costs']
    decision = pending['source_decision_fingerprint']
    rationale = pending['recommendation']['rationale']
    record = journal_record(costs, decision)
    before_j, after_j = costs.get('journal_before', {}), costs.get('journal_after', {})
    print(f"  decision {decision}\n  selected recipe {pending['recommendation']['selected_recipe_id']}, ranking {pending['recommendation']['ranked_recipe_ids']}")
    print(f'  rationale: {rationale}')
    print(f"  provider_costs: reservations {costs['reservations']}, live_calls {costs['live_calls']}, new_tokens {costs['new_tokens']}, cache_reuse {costs['cache_reuse']}")
    print(f"  journal: reservations {before_j.get('reservations')} -> {after_j.get('reservations')}, completed {before_j.get('completed_responses')} -> {after_j.get('completed_responses')}, unknown {after_j.get('unknown')}")
    if record:
        print(f"  this decision's journal record: usage {record['usage']}, reservation-to-response {record['latency_seconds']:.2f} s")
    check(pending['provenance']['recommendation_execution_mode'] == 'live_guarded', 'provenance is live_guarded')
    check(costs['live_calls'] == 1 and costs['reservations'] == 1 and costs['cache_reuse'] is False, 'accounting shows one new provider request and no cache reuse')
    check(after_j.get('reservations') == before_j.get('reservations', -1) + 1 and after_j.get('completed_responses') == before_j.get('completed_responses', -1) + 1,
          'journal gained exactly one reservation with a durable response')
    check(after_j.get('unknown') == before_j.get('unknown'), 'no unknown completion was added')
    check(record is not None and record['usage'] is not None and isinstance(record['usage'].get('total_tokens'), int), 'provider usage was recorded', record and record['usage'])
    check(costs['new_tokens'] == (record or {}).get('usage', {}).get('total_tokens'), 'new_tokens equals the recorded usage of the new decision')
    check('fallback=False' in rationale, 'the provider answer was parsed into a valid score vector (no fallback)')
    check(pending['recommendation']['constraint_violations'] == [] and pending['recommendation']['selected_recipe_id'] in pending['recommendation']['ranked_recipe_ids'],
          'selected recipe is from the safe ranking, with no constraint violation')
    if fake_before is not None:
        check(api.ok('GET', '/v1/capabilities')['fake_provider_calls'] - fake_before == 1, 'fake transport saw exactly one request')

    print('\n[3] replay of the identical command (same idempotency key): stored response, no new work')
    replay = api.ok('POST', f"/v1/sessions/{a['id']}/recommendations", {'expected_revision': 0}, recommend_key)
    check(replay == after, 'replay returns the identical stored response')
    check(api.ok('GET', f"/v1/sessions/{a['id']}")['pending']['source_decision_fingerprint'] == decision, 'GET returns the same pending decision')

    print('\n[4] a second, identical session: the same decision context must reuse the journaled decision')
    b = create(api, run)
    b_after = api.ok('POST', f"/v1/sessions/{b['id']}/recommendations", {'expected_revision': 0}, key('recommend-b'))
    bp = b_after['pending']
    bc = bp['provider_costs']
    print(f"  provider_costs: reservations {bc['reservations']}, live_calls {bc['live_calls']}, new_tokens {bc['new_tokens']}, cache_reuse {bc['cache_reuse']}")
    check(bp['source_decision_fingerprint'] == decision, 'same decision fingerprint')
    check(bp['recommendation']['ranked_recipe_ids'] == pending['recommendation']['ranked_recipe_ids'], 'same ranking')
    check(bp['provenance']['recommendation_execution_mode'] == 'live_guarded', 'reused live decision keeps live_guarded provenance')
    check(bc['live_calls'] == 0 and bc['reservations'] == 0 and bc['cache_reuse'] is True, 'no new provider request; cache reuse reported')
    check(bc['journal_after']['reservations'] == after_j.get('reservations'), 'journal reservations unchanged')
    if fake_before is not None:
        check(api.ok('GET', '/v1/capabilities')['fake_provider_calls'] - fake_before == 1, 'fake transport still saw exactly one request')

    state = {'run': run, 'decision': decision, 'session_a': a['id'], 'session_b': b['id'], 'ranking': pending['recommendation']['ranked_recipe_ids'],
             'journal_reservations': after_j.get('reservations'), 'journal_completed': after_j.get('completed_responses'), 'usage': record and record['usage']}
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
    print(f'\nstate written to {state_path}')


def phase_after_restart(api: Api, expect: str, state_path: Path) -> None:
    capabilities(api, expect)
    state = json.loads(state_path.read_text(encoding='utf-8'))
    print(f"\n[5] after restart: session {state['session_a']} is still stored")
    a = api.ok('GET', f"/v1/sessions/{state['session_a']}")
    check(a['pending'] is not None and a['pending']['source_decision_fingerprint'] == state['decision'], 'stored session keeps its live decision')
    check(a['pending']['provenance']['recommendation_execution_mode'] == 'live_guarded', 'stored provenance is live_guarded')
    print('[6] a third identical session: the decision must come from the durable journal, with no provider request')
    c = create(api, state['run'])
    cp = api.ok('POST', f"/v1/sessions/{c['id']}/recommendations", {'expected_revision': 0}, key('recommend-c'))['pending']
    cc = cp['provider_costs']
    print(f"  provider_costs: reservations {cc['reservations']}, live_calls {cc['live_calls']}, new_tokens {cc['new_tokens']}, cache_reuse {cc['cache_reuse']}")
    check(cp['source_decision_fingerprint'] == state['decision'] and cp['recommendation']['ranked_recipe_ids'] == state['ranking'], 'same decision and ranking as before the restart')
    check(cc['live_calls'] == 0 and cc['cache_reuse'] is True, 'no new provider request; cache reuse reported')
    check(cc['journal_after']['reservations'] == state['journal_reservations'], 'journal reservations unchanged across the restart', cc['journal_after']['reservations'])
    caps = api.ok('GET', '/v1/capabilities')
    if 'fake_provider_calls' in caps:
        check(caps['fake_provider_calls'] == 0, 'fake transport saw no request since the restart')


def phase_budget(api: Api, expect: str) -> None:
    caps = capabilities(api, expect)
    run = f"live-smoke-budget-{uuid.uuid4().hex[:8]}"
    print(f'\n[7] limit used up: a new context ({run}) must be refused before any provider request')
    s = create(api, run)
    status, value = api.call('POST', f"/v1/sessions/{s['id']}/recommendations", {'expected_revision': 0}, key('recommend-budget'))
    check(status == 409 and value.get('error', {}).get('code') == 'PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE', 'refused with PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE', f'HTTP {status} {value}')
    check(api.ok('GET', f"/v1/sessions/{s['id']}")['revision'] == 0, 'session unchanged (nothing committed)')
    if 'fake_provider_calls' in caps:
        check(api.ok('GET', '/v1/capabilities')['fake_provider_calls'] == caps['fake_provider_calls'], 'fake transport saw no request')


def main() -> int:
    parser = argparse.ArgumentParser(description='Controlled live guarded smoke check (no credentials involved).')
    parser.add_argument('--base-url', default='http://127.0.0.1:8785')
    parser.add_argument('--expect', choices=('real', 'fake'), required=True)
    parser.add_argument('--phase', choices=('first', 'after-restart', 'budget'), required=True)
    parser.add_argument('--state', default='backend/runtime/live_demo/smoke_state.json')
    args = parser.parse_args()
    api = Api(args.base_url)
    if args.phase == 'first':
        phase_first(api, args.expect, Path(args.state))
    elif args.phase == 'after-restart':
        phase_after_restart(api, args.expect, Path(args.state))
    else:
        phase_budget(api, args.expect)
    print(f"\n{'OK' if not failures else 'FAILED'}: {len(failures)} failed check(s)")
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
