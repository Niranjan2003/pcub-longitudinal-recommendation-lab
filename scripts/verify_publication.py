#!/usr/bin/env python3
"""Verify this repository against SOURCE_IDENTITY.json and the backend's sealed manifests.

Standard library only; any Python >= 3.9. Run from anywhere:

    python scripts/verify_publication.py

Checks
  1. Every source-derived file listed in SOURCE_IDENTITY.json exists with the recorded
     size and SHA-256. Unmodified frontend files also match their Git blob id at the source
     commit; frontend files modified or added for publication are listed, with their source
     blob ids (modified only) and reasons, under frontend.modified and frontend.added.
  2. No unlisted files exist under frontend/ or backend/ (generated, git-ignored
     directories such as node_modules/, .venv/, runtime/ and dist/ are skipped).
  3. Backend seals: implementation_ledger.json entries, the canonical fingerprint and
     per-file hashes of assets/subset_manifest.json, the golden capture manifest
     fingerprint, and every model-package manifest.
  4. The frontend's reference copies of the two backend reports equal backend/docs/
     after CRLF->LF normalisation.
  5. Every entry of the original reference-snapshot hash list (frontend.reference_snapshot,
     recorded with CRLF line endings) matches the published copy with LF converted to CRLF,
     and the backend original where there is one.
Exit status 0 when everything passes, 1 otherwise.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {'node_modules', 'dist', '.venv', 'venv', 'runtime', '__pycache__', 'test-results',
             'playwright-report', 'coverage', '.pytest_cache'}
SKIP_SUFFIXES = {'.pyc', '.tsbuildinfo'}

failures: list[str] = []


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b'blob %d\x00' % len(data) + data).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def check(ok: bool, message: str) -> bool:
    if not ok:
        failures.append(message)
    return ok


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def main() -> int:
    identity = read_json(ROOT / 'SOURCE_IDENTITY.json')
    listed: dict = identity['files']
    publication = set(identity['publication_files'])
    modified = {'frontend/' + m['path'] for m in identity['frontend'].get('modified', [])}
    added = {'frontend/' + a['path'] for a in identity['frontend'].get('added', [])}

    # 1. listed files
    for rel, meta in listed.items():
        if rel.startswith('frontend/'):
            kind = 'added' if rel in added else 'modified' if rel in modified else 'unmodified'
            expected = {'added': (False, False), 'modified': (False, True), 'unmodified': (True, False)}[kind]
            check(('git_blob' in meta, 'source_git_blob' in meta) == expected,
                  f'identity inconsistent for {rel} ({kind}): unmodified files carry git_blob, modified files source_git_blob, added files neither')
        path = ROOT / rel
        if not check(path.is_file(), f'missing: {rel}'):
            continue
        data = path.read_bytes()
        if not check(len(data) == meta['size'] and sha256(data) == meta['sha256'], f'content differs: {rel}'):
            continue
        if 'git_blob' in meta:
            check(git_blob(data) == meta['git_blob'], f'git blob differs: {rel}')
    print(f'[1] {len(listed)} listed files checked ({len(modified)} frontend files modified and {len(added)} added for publication)')

    # 2. unexpected files
    extra = []
    for top in ('frontend', 'backend'):
        for path in (ROOT / top).rglob('*'):
            rel_parts = path.relative_to(ROOT).parts
            if not path.is_file() or SKIP_DIRS.intersection(rel_parts) or path.suffix in SKIP_SUFFIXES:
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel not in listed and rel not in publication:
                extra.append(rel)
    for rel in sorted(extra):
        check(False, f'unlisted file: {rel}')
    print(f'[2] unlisted files under frontend/ and backend/: {len(extra)}')

    # 3. backend seals
    backend = ROOT / 'backend'
    ledger = read_json(backend / 'implementation_ledger.json')
    for entry in ledger['files']:
        p = backend / entry['path']
        check(p.is_file() and sha256(p.read_bytes()) == entry['sha256'], f'ledger mismatch: backend/{entry["path"]}')
    check(sha256((backend / 'implementation_ledger.json').read_bytes()) == identity['backend']['implementation_ledger']['sha256'],
          'implementation_ledger.json differs from SOURCE_IDENTITY.json')

    subset = read_json(backend / 'assets/subset_manifest.json')
    unsigned = {k: v for k, v in subset.items() if k != 'fingerprint'}
    check(sha256(canonical(unsigned).encode()) == subset['fingerprint'], 'subset manifest seal broken')
    check(subset['fingerprint'] == identity['backend']['asset_subset_manifest']['fingerprint'], 'subset fingerprint differs from identity')
    for entry in subset['files']:
        p = backend / 'assets' / entry['destination']
        check(p.is_file() and sha256(p.read_bytes()) == entry['sha256'], f'asset mismatch: backend/assets/{entry["destination"]}')

    capture = read_json(backend / 'assets/golden/capture_manifest.json')
    unsigned = {k: v for k, v in capture.items() if k != 'fingerprint'}
    check(sha256(canonical(unsigned).encode()) == capture['fingerprint'] == identity['backend']['golden_capture_fingerprint'],
          'golden capture manifest seal broken')

    models = sorted((backend / 'assets/models').glob('*/manifest.json'))
    for manifest in models:
        for art in read_json(manifest)['artifacts']:
            p = manifest.parent / art['path']
            check(p.is_file() and sha256(p.read_bytes()) == art['sha256'], f'model artifact mismatch: {p.relative_to(ROOT).as_posix()}')
    print(f'[3] backend seals: ledger {len(ledger["files"])} files, assets {len(subset["files"])} files, '
          f'capture {capture["fingerprint"][:12]}..., {len(models)} model packages')

    # 4. reference copies of backend reports
    for name in ('MASTER_SYSTEM_REPORT.md', 'CODE_ARCHITECTURE_REFERENCE.md'):
        original = (backend / 'docs' / name).read_bytes().replace(b'\r\n', b'\n')
        copy = (ROOT / 'frontend/docs/reference' / name).read_bytes()
        check(original == copy, f'frontend/docs/reference/{name} differs from backend/docs/{name}')
    print('[4] frontend reference copies of backend reports compared')

    # 5. original reference-snapshot hashes (CRLF bytes)
    entries = identity['frontend']['reference_snapshot']['entries']
    excluded = {e['path']: e['sha256'] for e in identity['frontend']['excluded_tracked']}
    for entry in entries:
        if 'published_copy' in entry:
            copy = (ROOT / entry['published_copy']).read_bytes()
            crlf = copy.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
            check(sha256(crlf) == entry['sha256'], f'reference snapshot hash differs: {entry["published_copy"]}')
        if 'backend_original' in entry:
            check(sha256((ROOT / entry['backend_original']).read_bytes()) == entry['sha256'],
                  f'reference snapshot hash differs: {entry["backend_original"]}')
        if 'excluded_tracked' in entry:
            check(excluded.get(entry['excluded_tracked']) == entry['sha256'],
                  f'reference snapshot entry inconsistent with excluded file: {entry["file"]}')
    print(f'[5] {len(entries)} original reference-snapshot hashes checked')

    if failures:
        print(f'\nFAILED ({len(failures)} problem(s)):')
        for line in failures[:50]:
            print('  -', line)
        if len(failures) > 50:
            print(f'  ... and {len(failures) - 50} more')
        if any(f.startswith(('content differs: backend/', 'ledger mismatch', 'asset mismatch')) for f in failures):
            print('\nHint: backend hash mismatches usually mean line endings were converted on checkout; see SETUP.md section 6.')
        return 1
    fe = identity['frontend']
    print(f'\nOK: frontend = {fe["commit"][:12]} ({fe["branch"]}), '
          f'backend ledger {identity["backend"]["implementation_ledger"]["sha256"][:12]}..., '
          f'asset subset {subset["fingerprint"][:12]}...')
    return 0


if __name__ == '__main__':
    sys.exit(main())
