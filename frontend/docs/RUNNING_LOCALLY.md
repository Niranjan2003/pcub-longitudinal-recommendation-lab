# Running the PCUB lab locally

Run locally, the research application talks to a **separately started, offline** PCUB backend through a same-origin
Vite proxy. This frontend never starts, stops or modifies the backend.

## 1. Prerequisites

* Node.js ≥ 22.12 (verified with 24.18) and npm.
* The PCUB backend running **offline** on `127.0.0.1:8765` (step 2).
* Microsoft Edge or Chrome only if you want to run the browser tests.

## 2. Start the backend (operator action, offline only)

From PowerShell, in the backend folder, using a dev-only database. **Do not pass `--live`, a provider token or the
existing provider-journal path.**

```powershell
$Backend = 'C:\path\to\checkout\backend'   # the backend\ folder of your checkout
$Python = Join-Path $Backend '.venv\Scripts\python.exe'
$env:PYTHONPATH = Join-Path $Backend 'src'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DEMO_FRONTEND_ORIGIN = 'http://localhost:5173'
Set-Location -LiteralPath $Backend
& $Python -B -m demo_backend.api.server --assets .\assets --database .\runtime\frontend_dev.sqlite3 --port 8765
```

Check it in PowerShell: `Invoke-RestMethod http://127.0.0.1:8765/v1/capabilities` must show `mode` = `offline` and
`live_guarded` = `False`.
The application's header also shows this: **Backend connected** for an offline backend, **Live backend connected** for
a live-capable one.

## 3. Start the frontend

```powershell
npm ci            # or: npm install
npm run dev       # http://localhost:5173   (must be exactly this origin; the port is strict)
```

For a production-like local preview: `npm run build` then `npm run preview` (same origin and proxy).

The proxy forwards `/v1` to `http://127.0.0.1:8765`. No token or credential is ever placed in the browser bundle.

## 4. Verify

| Command | What it checks |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint (includes a rule forbidding science math in the client) |
| `npm test` | 144 component/unit tests (MSW, no backend needed), including the live-mode workflow and the constraint-control and display repairs |
| `npm run test:integration` | 54 tests of the real client code against the **live offline backend**. It aborts unless `mode` is `offline`. It creates scratch sessions and comparison jobs in the backend's runtime database. |
| `npm run test:e2e` | 32 Playwright browser tests against the dev server + offline backend (axe accessibility, 375px layouts, full human and synthetic flows). Uses the system Edge channel; no download. |
| `npm run build` | Production build |
| `npm run test:live-fake` / `npm run test:e2e:live-fake` | 8 client and 6 browser tests of the optional live guarded workflow against the **fake-provider harness** (`scripts/fake_live_backend.py`), never a real provider. See [`../../LIVE_GUARDED_MODE.md`](../../LIVE_GUARDED_MODE.md) §5. |

Passing tests is functional evidence that the frontend uses the API correctly. It is not empirical validation. The
dated record of what was run, against which commit, and what is still unverified is in
[`OPERATOR_VERIFICATION_CHECKLIST.md`](OPERATOR_VERIFICATION_CHECKLIST.md#7-verification-record).

To run a second copy beside one already using ports 5173 and 8765, start its backend on another port (with
`DEMO_FRONTEND_ORIGIN` set to the new frontend origin) and set `PCUB_FRONTEND_PORT` and `PCUB_BACKEND_URL` before
`npm run dev`, `npm run test:integration` or `npm run test:e2e`. The repository's `SETUP.md` shows an example.

## 5. Guided demonstration (about 10 minutes)

This is a short route through the app. For explanations see [`USER_GUIDE.md`](USER_GUIDE.md); for pass criteria and
what each step was verified by, see [`OPERATOR_VERIFICATION_CHECKLIST.md`](OPERATOR_VERIFICATION_CHECKLIST.md).
Specific recipes and numbers differ between scenarios, because each new scenario gets a new identity, candidate window
and seeds.

1. **Overview** (`/`): read the five-step loop; select each step (arrow keys work) and note the “Bound” under each. Scroll
   to the evidence legend: every kind of result looks different and is always labelled.
2. **Human session** (**Live Session**, `/lab` → Human interaction): choose an example persona → *Create scenario* → *Get recommendation*.
   Point out: the **dashed forecast** (“not an outcome”), the hard-constraint disclaimer (not allergy certification),
   the conformal sets (diagnostic only). Pick a reaction (optionally add a typed requested change) → *Submit*. See
   **Forecast (made before reveal)** beside **Realized**, the timeline entry, and the engineered-state chart point
   (marker shape = the reaction).
3. **Longitudinal change**: continue two or three turns. With the contextual or class-bias predictor, open the
   **Adaptation lens**: the returned forecast may differ from the frozen population vector after reveals (it never
   does with the population predictor). The state charts only show points this browser observed.
4. **Branch explorer** (from a pending turn → *Open the branch explorer*): choose two different policies, an allocator
   and a budget. Note that the oracle is disabled for human sessions, and that branches always use the frozen
   **population** predictor whatever the session's predictor is.

   Run it. It is synchronous: the page shows elapsed time and says it cannot report progress or be cancelled.

   On the result:
   - the hypothetical tree, showing exactly the nodes the backend expanded (in every tested run, as many as the budget);
   - the expansion-order stepper and per-node policy evidence;
   - limited estimates;
   - **oracle and metrics shown as absent (not zero)**;
   - the three-group cost ledger. A full 20-node preparation pass precedes the budgeted evaluation, and offline
     provider counts are 0.
5. **Synthetic session with the oracle** (**Live Session** → Synthetic simulation → either scenario → *Create scenario*):
   *Run 3 turns with simulator reactions*, *Get recommendation for turn 4*, *Open the branch explorer*, leave the oracle
   on, *Run*. Back in the session, *Reveal the simulated reaction*, then *Run all … remaining turns* completes the 2 × 6
   plan; the closed session shows a trajectory summary of every turn.

   Show:
   - the **synthetic reference** panel (values, “never human ground truth”);
   - `regret`;
   - the plain statement of whether the limited selection agreed with the reference.

   Agreement and regret **vary between runs and simulators**, and one comparison is one case, not a general result. In
   one captured run the agenda simulator disagreed (regret ≈ 0.072) while the structured one agreed. Whatever happens
   is shown with equal prominence.
6. **Frozen R1 archive** (`/r1`): the claim verbatim, `formal closure present: false`, RQ1 negative gain, RQ2
   sensitivity ≠ utility, RQ3 strict superiority not established, RQ4 operational and replay evidence. Nothing here
   changes with your sessions.
7. **Method** (`/method`): the layered architecture and authority map, information boundaries, limitations, glossary.
8. **System** (`/system`): backend capabilities, the command journal, and the local index. The journal and the
   session and comparison lists are stored **in this browser only**; the backend has no listing endpoint.

## 6. Troubleshooting

| You see | Meaning / fix |
|---|---|
| “Backend not reachable” | Start the offline backend (step 2). |
| “Origin denied (403)” | Start the backend with `DEMO_FRONTEND_ORIGIN=http://localhost:5173` and open the app at `http://localhost:5173` (not `127.0.0.1:5173`). |
| “Backend requires an operator token (401)” | The backend has `DEMO_API_TOKEN` set. This app never handles tokens; run it without one. |
| `NO_SAFE_RECOMMENDATION` | The declared hard constraints removed every candidate; constraints are never relaxed. Create a new scenario. |
| `RECORDED_CONTEXT_UNAVAILABLE` | Offline, the guarded-LLM policy only answers 77 exact recorded contexts. New human scenarios generally got this answer. A request that exactly matches a recorded context succeeds with a recorded decision and no live call (observed for a structured synthetic fixture in the real-backend test). No policy is substituted. |
| `INSUFFICIENT_HORIZON` | A comparison needs the root plus two further turns in the plan (observed: a 1 × 2 plan fails at turn 1, while 1 × 3 works). |
| My sessions are missing from the Live Session list | The list is stored in this browser only. Reopen a session with **Open by id** (ids can be read from an index exported on `/system` in the original browser; there is no import). The data is still in the backend database. |
| An **uncertain** command in the journal | A response was lost. On `/system` or in the session, use **Recover** (replays the identical request with the same idempotency key). Never automatic. |
| `PROVIDER_UNKNOWN_COMPLETION` | Live mode only. Never retry. Preserve the provider journal. The page stops live requests until it is reloaded, and the backend never sends that decision again. |
| `PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE` | Live mode only. The operator's live-call limit is used up (every reservation in the journal counts), or another process holds the journal's writer lock. Nothing was sent or committed. |

## 7. Safety boundaries

* Offline by default. On a backend started in optional live mode (`../../LIVE_GUARDED_MODE.md`):
  * a guarded-LLM recommendation is sent only after explicit per-session permission, at most one provider request per click;
  * multi-turn runs and guarded branch comparisons are disabled;
  * the browser never receives or stores provider credentials.
* No automatic retries of any POST; recovery is a visible, user-initiated, same-key replay.
* The frontend computes no scientific value (probabilities, utilities, estimates, regret, oracle values, set
  membership, costs). It renders backend responses and keeps human, synthetic, hypothetical, oracle and historical
  evidence visibly separate.
* Not a production-scale or multi-user service: no accounts; a session id is an identifier, not a credential. Local
  success does not establish public-hosting readiness, multi-user isolation or production security.
