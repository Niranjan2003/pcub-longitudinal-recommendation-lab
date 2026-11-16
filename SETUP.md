# Setup, verification and running locally

All commands start in the repository root unless stated otherwise. The backend and the frontend are separate processes. The frontend never starts, stops or modifies the backend.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | **3.12.10** exactly | `backend/pyproject.toml` pins `requires-python = "==3.12.10"`. The recorded release evidence used CPython 3.12.10 on Windows. |
| Node.js / npm | Node **≥ 22.12** | Verified with Node 24.18.0 and npm 11.16.0. |
| Git | any recent | The repository's `.gitattributes` must be honored (see §7). |
| Microsoft Edge | optional | Only for the Playwright browser tests, which use the system `msedge` channel. |

**Windows: enable long paths before cloning.** The longest repository-relative path is 173 characters (a golden trajectory fixture). Without long-path support, Git fails with `Filename too long` once the clone directory is longer than about 85 characters. Do one of the following:

- enable Git long-path support, then clone:

  ```powershell
  git config --global core.longpaths true
  git clone <repository-url> C:\src\pcub
  ```

- or clone into a short directory such as `C:\src\pcub`.

Python and Node read the deep fixture paths through the operating system. If the checkout path plus 173 characters exceeds 260, Windows must also have long paths enabled (`LongPathsEnabled`, usually set by an administrator). A short checkout directory avoids the question.

## 2. Verify the checkout

Run this first. It uses the standard library only and works with any Python ≥ 3.9.

```bash
python scripts/verify_publication.py
```

It checks:

- every source-derived file against `SOURCE_IDENTITY.json`;
- the frontend Git-blob identities;
- the backend's sealed ledgers;
- the original reference-snapshot hashes.

It ends with `OK: …`. If it reports hash mismatches under `backend/`, your checkout converted line endings; see §7.

## 3. Backend

### Install

macOS / Linux:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1
```

Windows PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHONPATH = 'src'; $env:PYTHONDONTWRITEBYTECODE = '1'
```

`requirements.txt` pins the four direct dependencies: numpy 2.5.1, pandas 3.0.3, pydantic 2.13.4 and pyarrow 24.0.0. The full resolved set used for the recorded release is in `backend/release_evidence/package_versions.txt` (UTF-16 encoded).

### Verify and test

The examples use the macOS/Linux interpreter path. On Windows use `.\.venv\Scripts\python.exe`.

```bash
.venv/bin/python -B tools/verify_source.py
.venv/bin/python -B -m unittest discover -s tests -t . -v
```

- `verify_source.py` checks the 87 files in `implementation_ledger.json` and parses all Python sources. It prints `Documented file hashes and Python syntax verified`.
- The suite runs **18 tests** and takes a few minutes. Tests use temporary directories and do not write to `assets/` or `runtime/`.

### Run the API (offline)

macOS / Linux:

```bash
DEMO_FRONTEND_ORIGIN=http://localhost:5173 \
  .venv/bin/python -B -m demo_backend.api.server --assets assets --database runtime/demo.sqlite3 --port 8765
```

Windows PowerShell:

```powershell
$env:DEMO_FRONTEND_ORIGIN = 'http://localhost:5173'
.\.venv\Scripts\python.exe -B -m demo_backend.api.server --assets assets --database runtime/demo.sqlite3 --port 8765
```

- The server binds to `127.0.0.1` only. At start-up it re-verifies the SHA-256 of all 320 assets and refuses to start if any differs.
- Check that it is offline: `GET http://127.0.0.1:8765/v1/capabilities` must report `"mode": "offline"` and `"live_guarded": false`.

| Variable | Purpose |
|---|---|
| `DEMO_FRONTEND_ORIGIN` | The single browser origin allowed to call the API. It must equal the origin you open the app at: `http://localhost:5173` by default. |
| `DEMO_API_TOKEN` | Optional shared bearer token. Leave it unset for the frontend: the frontend never handles tokens. |

### Runtime state

The `--database` path is created on demand. With the commands above, that is `backend/runtime/demo.sqlite3` plus its SQLite `-wal`/`-shm` files.

`backend/runtime/` and all `*.sqlite3` files are git-ignored. The repository ships no runtime database, so a fresh checkout starts with no sessions.

Everything that creates sessions writes into this database: the interface, the integration tests and the browser tests. Use a disposable path such as `runtime/dev.sqlite3` when testing.

### Offline, recorded guarded decisions and live mode

- In offline mode, the backend makes no network calls.
- The guarded LLM scorer answers only the **77 recorded decision contexts** in `assets/golden/recorded_decisions/`, with execution mode `recorded_guarded` and zero live calls.
- Any other guarded request returns `RECORDED_CONTEXT_UNAVAILABLE`, and no other policy is substituted.
- Live guarded mode (`--live`) is **optional and operator-attended**. Start it only with `scripts/start_live_backend.ps1`, which prompts for the provider endpoint and token, or takes them from `DEMO_PROVIDER_ENDPOINT` and `DEMO_PROVIDER_TOKEN`, and passes them only to the backend process. It writes a durable provider journal and enforces a total live-call limit. Windows only. No other step in this guide needs it. See [`LIVE_GUARDED_MODE.md`](LIVE_GUARDED_MODE.md).
- Never commit provider tokens or journals. `.env*`, `*.sqlite3` and `backend/runtime/` are git-ignored.

## 4. Frontend

```bash
cd frontend
npm ci
npm run dev            # http://localhost:5173 (strict port); proxies /v1 to 127.0.0.1:8765
```

Open the app at `http://localhost:5173`, not `127.0.0.1:5173`, so that the origin matches `DEMO_FRONTEND_ORIGIN`.

| Command | Needs backend? | What it checks | Expected |
|---|---|---|---|
| `npm run typecheck` | no | TypeScript project build | exit 0 |
| `npm run lint` | no | ESLint, including a rule forbidding science math in the client | exit 0 |
| `npm test` | no | Unit and component tests (Vitest + MSW), including the live-mode workflow and the constraint-control and display repairs | 144 passed |
| `npm run build` | no | Production build to `dist/`. A chunk-size warning is expected. | exit 0 |
| `npm run test:integration` | **yes**, offline | Real client code against the running backend, reached at `PCUB_BACKEND_URL` (default `http://127.0.0.1:8765`). It aborts unless the backend reports `mode: offline`, and it creates scratch sessions in the backend database. | 54 passed |
| `npm run test:e2e` | **yes**, offline | Playwright browser acceptance: axe accessibility, 375 px layouts, human and synthetic flows. Starts `npm run dev` on `PCUB_FRONTEND_PORT` (default 5173), or reuses a dev server already listening there. | 32 passed |
| `npm run test:live-fake` | **yes**, the fake-provider harness | The real client against the unmodified backend in live mode with a fake in-process provider (`scripts/fake_live_backend.py`, fresh journal, `--live-call-limit 8`). Aborts unless the harness marker is reported. | 8 passed |
| `npm run test:e2e:live-fake` | **yes**, the fake-provider harness | Browser tests of the live workflow (permission gate, accounting, cache reuse, unknown completion, 375 px). Fresh harness with `--live-call-limit 10`. | 6 passed |

`npm ci` may print `allow-scripts` warnings for `esbuild` and `msw` install scripts. The build and tests above pass without approving them.

## 5. Using other ports

The defaults are backend `127.0.0.1:8765` and frontend `localhost:5173`. To run a second checkout beside one that already uses them, change all three settings together:

- the backend's `--port`;
- its `DEMO_FRONTEND_ORIGIN`;
- the frontend's `PCUB_FRONTEND_PORT` and `PCUB_BACKEND_URL`.

The frontend's status and error messages still name the default addresses.

macOS / Linux:

```bash
# terminal 1 (backend/)
DEMO_FRONTEND_ORIGIN=http://localhost:5174 \
  .venv/bin/python -B -m demo_backend.api.server --assets assets --database runtime/dev.sqlite3 --port 8775
# terminal 2 (frontend/)
export PCUB_FRONTEND_PORT=5174 PCUB_BACKEND_URL=http://127.0.0.1:8775
npm run dev                  # or: npm run test:integration / npm run test:e2e
```

Windows PowerShell:

```powershell
# terminal 1 (backend\)
$env:DEMO_FRONTEND_ORIGIN = 'http://localhost:5174'
.\.venv\Scripts\python.exe -B -m demo_backend.api.server --assets assets --database runtime/dev.sqlite3 --port 8775
# terminal 2 (frontend\)
$env:PCUB_FRONTEND_PORT = '5174'; $env:PCUB_BACKEND_URL = 'http://127.0.0.1:8775'
npm run dev
```

## 6. Guided demonstration

Once both servers are running, follow the 10-minute walkthrough in [`frontend/docs/RUNNING_LOCALLY.md`](frontend/docs/RUNNING_LOCALLY.md) §5, and the explanations in [`frontend/docs/USER_GUIDE.md`](frontend/docs/USER_GUIDE.md). [`frontend/docs/OPERATOR_VERIFICATION_CHECKLIST.md`](frontend/docs/OPERATOR_VERIFICATION_CHECKLIST.md) lists manual checks with expected results.

## 7. Line endings and byte identity

The backend verifies raw-byte SHA-256 hashes of its sources and assets. Some of those files use CRLF line endings and others use LF.

The repository's `.gitattributes` marks `backend/**` as `-text`, so Git never converts them, even with `core.autocrlf=true`. Do not re-save backend files in an editor that rewrites line endings.

If you obtained the code as a ZIP download, or with a tool that ignores `.gitattributes`, run `python scripts/verify_publication.py` before trusting any result.

The frontend's reference copies in `frontend/docs/reference/` are stored with LF endings. The snapshot's original hash list recorded them with CRLF endings. That list is preserved in `SOURCE_IDENTITY.json` (`frontend.reference_snapshot`), and the verifier checks each entry by converting LF to CRLF.
