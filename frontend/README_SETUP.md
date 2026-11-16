# Frontend setup

This is the research interface for the PCUB testbed. It talks to a **separately started, offline** backend through the same-origin Vite proxy (`/v1` → `http://127.0.0.1:8765`).

## Start the backend first

From the repository root, set up and start the backend as described in [`../SETUP.md`](../SETUP.md) §3. In short, inside `backend/` with its virtual environment:

```bash
export PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1
DEMO_FRONTEND_ORIGIN=http://localhost:5173 \
  .venv/bin/python -B -m demo_backend.api.server --assets assets --database runtime/demo.sqlite3 --port 8765
```

For the normal offline setup, do not pass `--live`, a provider token or a provider-journal path. Optional live guarded mode is started only with `../scripts/start_live_backend.ps1` (see [`../LIVE_GUARDED_MODE.md`](../LIVE_GUARDED_MODE.md)). On a live-capable backend the interface sends a guarded-LLM recommendation only after explicit per-session permission, one request per click, and never handles credentials.

## Then start the frontend

```bash
npm ci
npm run dev     # open http://localhost:5173
```

Tests, build, non-default ports and the guided demonstration: [`../SETUP.md`](../SETUP.md) §4–6 and [`docs/RUNNING_LOCALLY.md`](docs/RUNNING_LOCALLY.md).

---

*Publication note:* this file replaces the original `README_SETUP.md` of the frontend source commit. The original was a workstation-specific setup guide. The replacement keeps the original file name. See `SOURCE_IDENTITY.json`.
