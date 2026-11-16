# Live guarded LLM scoring (optional)

The backend has always contained an optional live path for one policy, `guarded_llm_score_vector@1`: a language model scores a safe shortlist that the backend has already produced. This release adds a safe, explicit frontend workflow for that path, an operator launcher, a fake-provider test harness and a smoke check. **No backend file was changed.** `backend/` is still byte-identical to its sealed implementation ledger, so parsing, request hashing, journal semantics, cost accounting, the no-retry rule and `live_guarded` provenance are exactly the original ones.

Offline mode is unchanged and remains the default. Without `--live` the backend makes no network calls, and nothing in this document applies.

## 1. What the live model may and may not do

For each recommendation of a guarded session the backend:

1. applies the declared hard constraints (catalog-metadata rule filter) to the turn's candidate window;
2. builds a **safe shortlist of at most 10** of the remaining recipes: all of them when there are 10 or fewer, otherwise the top candidates of the feedback-sequence and deterministic policies;
3. sends the observable context and the shortlist to the model, which must return **one integer score from 0 to 100 per shortlisted position**, plus reason codes and a short trade-off text, under a strict JSON schema;
4. sorts the scores into the ranking (ties by recipe id) and recommends the top recipe.

An answer that is not a valid score vector is recorded as such, and the backend uses its precomputed fallback, the feedback-sequence ranking of the same safe candidates.

The model cannot add recipes, relax or bypass constraints, generate human or synthetic reactions, change session state, change the predictor, or touch PCUB mathematics or the historical R1 evidence. It is not a chat agent: there is no free-form conversation anywhere in the system.

## 2. How one live request is handled (backend, unchanged)

The decision key is the SHA-256 of the canonical decision input (prompt version and hash, settings, observable context, candidate mapping and fallback hash).

- If the key is one of the 77 recorded decisions, or is already in the provider journal, the stored decision is reused and **no request is sent**.
- Otherwise the journal **reserves** the key first. The reservation counts against the operator's total live-call limit, and every row in the journal counts.
- The backend then makes **one HTTPS attempt**: no redirects, no retries, a 60-second timeout and a 1 MiB response limit. It stores the complete decoded response durably before parsing it.
- If the outcome of the attempt is uncertain (timeout, transport error or HTTP error), the reservation stays without a response. The backend answers `PROVIDER_UNKNOWN_COMPLETION` and will **never send that decision again**.
- When the limit is reached, or another writer holds the journal lock, the backend answers `PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE` before any request is made.

Recommendation provenance is `recorded_guarded` for recorded decisions and `live_guarded` for decisions that came from a provider response, whether new or reused from the journal. Every response includes `provider_costs`:

- `reservations`, `live_calls` and `new_tokens` for this command;
- `cache_reuse`;
- in live mode, before-and-after snapshots of the whole journal, with the provider's own token usage and the reservation-to-response time per decision.

No monetary cost is computed.

## 3. What the interface does when the backend is live-capable

- **Status.** A small indicator at the end of the header shows **Live backend connected** (an offline backend shows **Backend connected**). It carries no other live-LLM text: the guarded LLM and its per-session permission are introduced on the Live Session page, and the System page lists the backend's capabilities. Until the presentation pass of 15 November 2026 a red *LIVE PROVIDER MODE* banner took this place, and until 16 November 2026 a full-width status strip; the real run recorded in section 8 was made with the banner interface. The permission gate below did not change.
- **Live Session form.** The guarded LLM scorer can be chosen, with a note that live scoring is available and that the session asks for permission first. Creating a session sends nothing to the provider.
- **Session page.** A *Live guarded LLM scoring* panel explains the points above. **Nothing that could reach the provider is sent until the user ticks the acknowledgement and presses *Allow live provider requests for this session*.**
  - The permission is per session and held in memory only. A reload, a new tab or another session asks again, and it can be withdrawn at any time.
  - The button reads *Get recommendation for turn N (may send 1 live provider request)*. Each click is one command, which can make at most one provider request.
- **Synthetic sessions.** Only *Run 1 turn* is available, and only with permission. *Run 3 turns* and *Run all remaining turns* are disabled, so no hidden multi-call automation exists.
- **Provider work panel**, shown under every recommendation. It gives:
  - the execution mode;
  - reservations, live calls and new tokens;
  - **cache reuse in words**: new provider response, journaled live decision, recorded decision, or not applicable;
  - the decision fingerprint;
  - the journal totals (reservations, completed responses, unknown completions);
  - this decision's token usage and response time, exactly as returned.
- **Unknown completion.** The command is journaled as *terminal* (never retried, no *Recover* button). The page then stops all live requests until it is deliberately reloaded, and the backend's instruction is shown verbatim.
- **Recovery.** Recovering an *uncertain* command stays a manual, same-key replay. In live mode the journal page says that a decision the backend already reserved is never sent twice.
- **Branch explorer.** Comparisons that include the guarded LLM are **disabled in live mode**. A comparison's preparation pass needs a guarded decision for the root and for each of the 20 hypothetical nodes, so up to 21 provider requests could happen inside one synchronous request that cannot report progress or be cancelled. Deterministic pairs make no provider request and remain available.
- **Credentials.** The interface never receives, asks for or stores the provider endpoint or token. They exist only in the backend process.

## 4. Operator procedure (Windows)

As released, live mode is Windows-only: the journal's single-writer lock uses `msvcrt`.

Prerequisites:

- the backend's virtual environment (`SETUP.md` §3);
- an approved provider endpoint. It must be an OpenAI-compatible chat-completions URL that accepts `response_format: json_schema` and the model named in `backend/assets/configuration/inheritance.json`;
- a token for that endpoint.

Do not search old repositories for credentials.

1. **Start the live backend.** In PowerShell, from the repository root:

   ```powershell
   .\scripts\start_live_backend.ps1 -LiveCallLimit 2
   ```

   - The script takes `DEMO_PROVIDER_ENDPOINT` and `DEMO_PROVIDER_TOKEN` from the session if they are set, and removes them from the session. Otherwise it prompts for them, reading the token as a hidden `SecureString`.
   - It passes them only to the backend child process's environment, never on a command line, and never prints or writes them.
   - It starts the unmodified backend with `--live --live-call-limit 2 --journal runtime\live_demo\provider_journal.sqlite3` on port 8785, allowing the frontend origin `http://localhost:5175`.
   - Type `R` to restart with the same journal and database (durability check), or `Q` to stop. On exit it stops the backend and drops its copies of the credentials.
2. **Start a frontend for it,** in another terminal, in `frontend\`:

   ```powershell
   $env:PCUB_FRONTEND_PORT = '5175'; $env:PCUB_BACKEND_URL = 'http://127.0.0.1:8785'; npm run dev
   ```

   Open `http://localhost:5175`. The offline setup on 5173 and 8765 is unaffected.
3. **Use the guarded policy** in a human or synthetic session, allowing live requests in the session when you mean to.
4. **Stop with `Q`.** Keep the journal file as evidence. `backend/runtime/` is git-ignored: never commit journals or databases.

Use a new `-Journal` path for each rehearsal, because the limit counts every reservation the journal has ever made. A wrong token or endpoint results in an HTTP error, which the backend records as an unknown completion for that decision and never retries. Fix the configuration and use a new journal, keeping the old one.

## 5. Verification without a provider

| Check | Command | Result |
|---|---|---|
| Backend journal tests (fake transport: raw-response recovery without a second request; an unknown completion is never retried) | part of the backend suite (`SETUP.md` §3) | 2 of the 18 backend tests |
| Interface live workflow (MSW) | `npm test` (in `frontend/`) | 11 live-mode tests within the unit suite |
| Real client against the unmodified backend in live mode with a fake in-process provider | start `scripts/fake_live_backend.py` (below), then `npm run test:live-fake` | 8 pass |
| Browser workflow against the same harness | `npm run test:e2e:live-fake` | 6 pass |
| HTTP smoke check against the harness | `python scripts/live_smoke.py --expect fake --phase first`, then `after-restart`, then `budget` | all checks pass |

The harness (`scripts/fake_live_backend.py`) runs the real backend code in live mode. It replaces only `urllib.request.build_opener`, the same seam that `backend/tests/test_live_journal.py` patches, so no request leaves the machine. It adds `provider_transport: "fake_in_process_test_double"` and an independent transport counter (`fake_provider_calls`) to the capabilities response. Both live-fake suites and `live_smoke.py --expect fake` refuse to run unless that marker is present, and `--expect real` refuses to run if it is present.

A marker in the session's request text selects a failure:

- `fake-provider-timeout` produces an unknown completion;
- `fake-provider-invalid` produces a recorded fallback.

Example run, from the repository root (one backend per run, with a fresh database and journal):

```powershell
$env:DEMO_FRONTEND_ORIGIN = 'http://localhost:5176'
backend\.venv\Scripts\python.exe -B scripts\fake_live_backend.py --port 8786 --database backend\runtime\fake_live\demo.sqlite3 --journal backend\runtime\fake_live\provider.sqlite3 --live-call-limit 8
# in frontend\, another terminal:
$env:PCUB_BACKEND_URL = 'http://127.0.0.1:8786'; npm run test:live-fake
# for the browser suite (start a NEW harness with a fresh journal and --live-call-limit 10 first):
$env:PCUB_FRONTEND_PORT = '5176'; $env:PCUB_BACKEND_URL = 'http://127.0.0.1:8786'; npm run test:e2e:live-fake
```

## 6. Real-provider smoke check

With the live backend from §4 running (`-LiveCallLimit 2`, fresh journal):

```powershell
python scripts\live_smoke.py --base-url http://127.0.0.1:8785 --expect real --phase first
# type R in the launcher window to restart the backend, then:
python scripts\live_smoke.py --base-url http://127.0.0.1:8785 --expect real --phase after-restart
```

`first` makes exactly **one** provider request and checks:

- the parsed decision (no fallback) and `live_guarded` provenance;
- the accounting and the journal counts;
- an idempotent replay;
- cache reuse by an identical second session, with no request.

`after-restart` checks that the decision is still reused from the durable journal, again with no request. When the limit is used up, `--phase budget` checks the refusal without any request. The recorded outcome of the controlled run for this release is in §8.

## 7. Intentionally bounded in this version

- **One request per click.** There are no bulk multi-turn live runs.
- **No live guarded branch comparisons** (up to 21 decisions per comparison; synchronous and not cancellable).
- **The launcher is operator-started and Windows-only.** The release itself adds no hosting, multi-user isolation or rate limiting. The public demo runs the unchanged backend in a separate research deployment, with a global call limit and per-session permission.
- **The limit counts every reservation in the journal.** There is no provider-wide quota and no price calculation.
- **One OpenAI-compatible transport** with the model and decoding settings sealed in `inheritance.json` (temperature 0, no seed).
- **Conservative failure handling.** An HTTP or transport error becomes an unknown completion, never a retry.
- **Engineering evidence only.** Live decisions demonstrate the implemented capability. They are not R1 evidence and do not establish positive guarded utility gain. R1 found no positive gain.

## 8. Controlled real-provider run for this release (2026-11-15)

**Setup.**

- `scripts\start_live_backend.ps1 -LiveCallLimit 2`, with a fresh journal and database, and the frontend on port 5175.
- The provider was the operator's approved OpenAI-compatible endpoint, with the provider id and model sealed in `inheritance.json`.
- The operator typed the endpoint and token at the launcher's prompts, the token hidden, so they existed only in the backend process.

**The two provider requests.**

- The operator created a human scenario with the guarded policy: *Example persona B*, peanut allergy (the preset at the time; allergy inputs were disabled later the same day, see `frontend/docs/SCIENTIFIC_INTERPRETATION.md` §10), "Recommend a safe recipe.", 2 × 6.
- They allowed live requests on the session page and got recommendations for turns 1 and 2, reacting ACCEPT and then REJECT.
- These were the only provider requests of the run. They used up the limit through the interface path that the Demo uses, so the request of `live_smoke.py --phase first` was not made.
- From then on the journal was full. Every later check could only reuse a journaled decision, or be refused before the transport ran.

| | Turn 1 | Turn 2 |
|---|---|---|
| Provider requests, attempts | 1, 1 | 1, 1 |
| Provider `finish_reason` | `stop` | `stop` |
| Parsed result | 10 scores for the 10-recipe shortlist, no fallback | same |
| Provenance | `live_guarded` | `live_guarded` |
| Provider usage (input + output = total tokens) | 2,123 + 1,013 = 3,136 | 2,128 + 2,215 = 4,343 |
| `provider_costs` | reservations 1, live calls 1, new tokens 3,136, cache reuse false | 1, 1, 4,343, false |
| Reservation to response | 6.7 s | 12.6 s |
| Constraint violations of the selected recipe | none | none |

The provider reported the model name `cm-llm` for the sealed model id that the request named. The backend records both, as `requested_model` and `response_model`.

**Checks without provider requests.** These were 20 API checks. All passed before, and again after, restarting the backend with the launcher's `R`:

- **Real transport.** The backend reported `live_opt_in` with the real transport, with no fake-provider marker.
- **Journal integrity.** The journal held exactly two completed rows and no unknown completion. The backend's read-only `Journal.get` re-verified both records: request hash, record hash, and request-to-response binding.
- **Same-key replay.** Replaying the operator's turn-1 command with the same idempotency key returned the stored response byte for byte.
- **Cache reuse.** A new session with a byte-identical create body and the same turn-1 reaction resolved both turns to the same decision fingerprints and rankings. Both showed 0 reservations, 0 live calls, 0 new tokens and `cache_reuse: true`. The interface showed *Live decision reused from the provider journal*, with the original token usage and response time.
- **Limit refusal.** A new decision context was refused with `PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE`, and that session stayed at revision 0.
- **Restart durability.** The journal summary was identical before and after the restart.

**Afterwards.**

- The launcher was stopped with `Q`. No backend process remained, and neither provider variable was set in the user or machine environment.
- The journal and database contain no endpoint, token or authorization header.
- Both files stay in the git-ignored `backend/runtime/live_demo/` and are not part of this repository.

**Not exercised against the real provider:**

- an unknown completion (by design: fake harness only);
- an invalid answer with fallback (fake harness only);
- synthetic sessions with the live scorer;
- long sessions;
- more than two requests.
