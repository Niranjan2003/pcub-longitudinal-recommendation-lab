#!/usr/bin/env python3
"""Run the unmodified PCUB backend API in LIVE mode against an in-process FAKE provider.

For tests and rehearsals only. No request leaves this process: the fake replaces
``urllib.request.build_opener``, the same seam that backend/tests/test_live_journal.py
patches. Everything else is the real backend code, unchanged:

* Journal reservations and the single-writer lock;
* the total live-call ceiling (``--live-call-limit``);
* response size limits, parsing and the strict score schema;
* request and record hashing, and the no-retry handling of unknown completion;
* provider accounting and ``live_guarded`` provenance.

The capabilities response gains three extra fields, so that test suites can refuse to
run against a real live backend and can check the backend's accounting independently:

* ``provider_transport``: ``"fake_in_process_test_double"``;
* ``fake_provider_calls``: transport attempts made since this process started;
* ``fake_live_call_limit``.

The fake's behaviour is chosen per request by a marker in the session's request text:

* ``fake-provider-timeout``: the transport raises TimeoutError, which the backend
  records as an unknown completion (never retried);
* ``fake-provider-invalid``: the provider "answers" with text that is not JSON, which
  the guarded scorer records as a fallback to its precomputed safe ranking;
* anything else: one deterministic integer score (0-100) per shortlisted position.

Usage, from the repository root, with the backend's virtual environment (Windows):

    backend\\.venv\\Scripts\\python.exe -B scripts\\fake_live_backend.py --port 8785 ^
        --database backend\\runtime\\fake_live\\demo.sqlite3 ^
        --journal backend\\runtime\\fake_live\\provider.sqlite3 --live-call-limit 8

Set DEMO_FRONTEND_ORIGIN to the frontend origin, as for the real backend. Use a fresh
database and journal for every run. The journal's writer lock is Windows-only, like the
real live mode.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend' / 'src'))

from demo_backend.adapters.resources import Resources  # noqa: E402
from demo_backend.adapters.sqlite import Store  # noqa: E402
from demo_backend.api.server import handler  # noqa: E402
from demo_backend.application.backend import Backend  # noqa: E402

MARKER = 'fake_in_process_test_double'
# A syntactically valid HTTPS endpoint on a reserved, unresolvable domain. It is never contacted.
FAKE_ENDPOINT = 'https://fake-provider.invalid/v1/chat/completions'
FAKE_TOKEN = 'fake-test-token-not-a-credential'

_lock = threading.Lock()
_calls = 0


class _Reply:
    def __init__(self, wire: bytes):
        self.wire = wire

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, n: int) -> bytes:
        return self.wire[:n]


class _FakeOpener:
    def open(self, request, timeout=None):
        global _calls
        with _lock:
            _calls += 1
            number = _calls
        if request.full_url != FAKE_ENDPOINT:
            raise RuntimeError('Fake opener refused an unexpected URL')
        payload = json.loads(request.data.decode('utf-8'))
        prompt = payload['messages'][1]['content']
        count = payload['response_format']['json_schema']['schema']['properties']['candidate_scores']['minItems']
        if 'fake-provider-timeout' in prompt:
            print(f'[fake provider] call {number}: simulated timeout', file=sys.stderr, flush=True)
            raise TimeoutError('fake provider timeout')
        if 'fake-provider-invalid' in prompt:
            content = 'This is not a JSON score vector.'
        else:
            scores = [int(hashlib.sha256(f'{prompt}|{i}'.encode()).hexdigest()[:4], 16) % 101 for i in range(count)]
            content = json.dumps({'candidate_scores': scores, 'reason_codes': ['BALANCED_TRADEOFF'], 'tradeoff_summary': 'Fake provider test double.'})
        usage = {'prompt_tokens': len(prompt) // 4, 'completion_tokens': 20 + 4 * count}
        usage['total_tokens'] = usage['prompt_tokens'] + usage['completion_tokens']
        body = {'model': 'fake-provider-test-double', 'usage': usage, 'choices': [{'message': {'role': 'assistant', 'content': content}}]}
        print(f'[fake provider] call {number}: {count} candidates', file=sys.stderr, flush=True)
        return _Reply(json.dumps(body).encode('utf-8'))


def _fake_build_opener(*handlers):
    return _FakeOpener()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--assets', default=str(ROOT / 'backend' / 'assets'))
    parser.add_argument('--database', required=True)
    parser.add_argument('--journal', required=True)
    parser.add_argument('--port', type=int, default=8785)
    parser.add_argument('--live-call-limit', type=int, required=True)
    args = parser.parse_args()
    if args.live_call_limit < 1:
        parser.error('--live-call-limit must be positive')
    for name in ('DEMO_PROVIDER_ENDPOINT', 'DEMO_PROVIDER_TOKEN', 'DEMO_API_TOKEN'):
        if os.environ.get(name):
            parser.error(f'{name} is set in this environment. The fake harness never uses provider credentials; unset it first.')

    urllib.request.build_opener = _fake_build_opener
    config = {'journal': args.journal, 'maximum': args.live_call_limit, 'endpoint': FAKE_ENDPOINT, 'token': FAKE_TOKEN}
    Path(args.database).parent.mkdir(parents=True, exist_ok=True)
    backend = Backend(Resources(args.assets, config), Store(args.database))
    capabilities = backend.capabilities
    backend.capabilities = lambda: {**capabilities(), 'provider_transport': MARKER, 'fake_provider_calls': _calls, 'fake_live_call_limit': args.live_call_limit}

    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(backend, os.environ.get('DEMO_FRONTEND_ORIGIN')))
    print(f'[fake provider] live-mode backend with a FAKE provider on http://127.0.0.1:{args.port} (limit {args.live_call_limit})', file=sys.stderr, flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
