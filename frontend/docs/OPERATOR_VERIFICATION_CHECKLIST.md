# Operator verification checklist

For the person running the local system who must confirm that it works. Concepts are explained in
[`USER_GUIDE.md`](USER_GUIDE.md) and [`SCIENTIFIC_INTERPRETATION.md`](SCIENTIFIC_INTERPRETATION.md); startup commands
are in [`RUNNING_LOCALLY.md`](RUNNING_LOCALLY.md).

**Expected results** in this checklist are behaviours actually observed against the offline backend, or contract rules.
Specific recipes and numbers vary between scenarios, because each new scenario gets a new identity, candidate window and
seed namespace. They are therefore never given as pass criteria.

**"Verified by"** says how each check was last confirmed:
- **UI** – clicked through by hand in the browser;
- **E2E** – Playwright browser test against the real backend;
- **API** – real-backend integration test of the frontend client;
- **Mock** – component test with mocked responses only;
- **Fake** – the unmodified backend in live mode with the in-process fake provider of `scripts/fake_live_backend.py`
  (API = `npm run test:live-fake`, E2E = `npm run test:e2e:live-fake`); no network;
- **Real** – the controlled real-provider run recorded in §7 (two operator decisions through the interface, then checks
  that made no provider request).

---

## 0. Safety preflight (always first)

- [ ] In PowerShell, `Invoke-RestMethod http://127.0.0.1:8765/v1/capabilities` shows `mode` = `offline` and
      `live_guarded` = `False`.
- [ ] The backend was started **without** `--live`, a provider token, or the existing provider-journal path.
- [ ] The header indicator says **Backend connected**, not **Live backend connected**. If it says live, stop.
- [ ] Decide which database the backend uses. Every check below **creates sessions and comparison jobs** in it. Prefer
      a disposable dev database (see `RUNNING_LOCALLY.md`).

## 1. Automated suites

Run each separately, with the offline backend up and `npm run dev` either running or startable by Playwright.

| Command | Expected | Side effects |
|---|---|---|
| `npm run typecheck` | exit 0 | none |
| `npm run lint` | exit 0 | none |
| `npm test` | 144 passed | none (mocked; no backend needed) |
| `npm run build` | "built"; a >500 kB chunk notice is normal | writes `dist/` (gitignored) |
| `npm run test:integration` | 54 passed | **writes scratch sessions and jobs to the backend DB**; aborts unless offline |
| `npm run test:e2e` | 32 passed | **writes scratch sessions and jobs to the backend DB**; uses system Microsoft Edge |
| `npm run test:live-fake` | 8 passed | needs a fresh fake-provider harness (`--live-call-limit 8`); aborts unless its marker is reported |
| `npm run test:e2e:live-fake` | 6 passed | needs a fresh fake-provider harness (`--live-call-limit 10`) and `PCUB_FRONTEND_PORT` matching its `DEMO_FRONTEND_ORIGIN` |

Passing these shows the frontend calls the API correctly and renders it faithfully. It is **not** empirical or
scientific validation.

## 2. Manual checks — human world

| # | Do | Pass when | Verified by |
|---|---|---|---|
| H1 | Live Session → Human → example persona **"Vegetarian · ≤30 min total time"** → *Create scenario* (no allergy or exclusion inputs exist; pescatarian and "other" are disabled) | Redirected to the session; header shows "Human interaction", "Open", revision **0** | UI, E2E |
| H2 | *Get recommendation for turn 1* | Revision **1**; recipe total time ≤ 30 min or the turn errors honestly; hard-filter box says it is *not* allergy or clinical certification; forecast card is dashed and labelled "Forecast · pending"; conformal table labelled "Diagnostic only"; provider mini ledger shows reservations 0, live calls 0, new tokens 0, cache reuse false; timeline still empty | UI, E2E, API |
| H3 | Pick **Modify / clarify**, *+ Add a change*, tick `effort`, instruction "Please make it quicker to prepare.", *Submit reaction* | Revision **2**; "Forecast (made before reveal)" beside "Realized"; the realized row is highlighted in the forecast bars; provenance chips show `human_submission` and factual; timeline has one entry; state charts gain a point with a diamond marker; "Recent requested changes" lists the instruction | UI, E2E (other reactions), API |
| H4 | New scenario: Omnivore preset, horizon **2 segments × 2 turns**; play 3 turns | Timeline shows Segment 1 (T1, T2) and Segment 2 (T1); session still Open; history and state carried over | API (rollover asserted); UI not clicked |
| H5 | Same scenario: play the 4th turn | Session becomes **Closed · read-only record**; no recommend button | API; Mock (UI) |
| H6 | New scenario, choose **Disengage** on a reaction | A confirmation dialog appears; nothing is sent until confirmed; after confirming, the session is Closed with one history entry showing DISENGAGE | API, Mock |
| H7 | New scenario → *Get recommendation* → *Cancel and end session…* → confirm | Session Closed; the pending item appears struck through under "Cancelled"; no history entry; state unchanged | API (backend behaviour); the struck-through rendering has not been exercised |
| H8 | New scenario: dietary **vegan**, maximum total time **1**, maximum ingredients **0** → *Get recommendation* | Error panel `NO_SAFE_RECOMMENDATION` (HTTP 422) says constraints are never relaxed; revision stays **0** | API, Mock |
| H9 | New **human** scenario with policy **Guarded LLM scorer** → *Get recommendation* | Usually `RECORDED_CONTEXT_UNAVAILABLE` (409) mentioning the 77 recorded contexts; revision stays 0; policy unchanged and no other policy substituted. A recorded decision (execution mode `recorded_guarded`, 0 live calls) is also a valid outcome if the request exactly matches a recorded context. A live provider call is never valid. | API, Mock |
| H10 | Predictor **Population**, play 1 turn, open the Adaptation lens | Panel says the frozen predictor does not adapt (forecast = population vector) | API (equality asserted); panel not clicked through |

## 3. Manual checks — branch comparison (human)

| # | Do | Pass when | Verified by |
|---|---|---|---|
| B1 | From a pending turn (turn ≥ 2 recommended) → *Open the branch explorer* | Hypothetical ribbon; pinned factual root with revision; "frozen population model" callout; oracle checkbox **disabled** with the no-human-oracle reason; allocators equal, greedy, uncertainty-first, PCUB; budgets 2, 4, 8, 12 | UI, E2E |
| B2 | Defaults (Deterministic vs Feedback-sequence, PCUB, 8) → *Run branch comparison* | While running: elapsed seconds and "cannot report progress … cannot be cancelled". Then the result page shows **8** expanded node buttons (every tested run expanded exactly the budget); the other slots read "not expanded — no estimate" | UI, E2E (budget 4), API |
| B3 | Use the stepper (*Reset*, *Next expansion*) and click a node | Faint nodes fill in by expansion order; node detail shows both policies' step and cumulative probabilities, downstream recipe and utility components | UI, Mock |
| B4 | Read the oracle, metrics and costs | Oracle "No oracle result … an absence, not a zero"; metrics "Absent."; cost ledger with three groups (logical counters / preparation / evaluation and combined), offline provider values 0; "Session now: revision N" unchanged | UI, E2E, API |
| B5 | Repeat with each allocator × budget 2, 4, 12 | Each completes; node count = budget; session unchanged | API (all 16 combinations); UI spot-checked |
| B6 | New scenario, horizon **1 segment × 2 turns**, recommend turn 1, run a comparison | `INSUFFICIENT_HORIZON` (422). With **1 × 3** it succeeds | API |
| B7 | Choose the same policy for A and B | Run button disabled; "Choose two different policies." | Mock |

## 4. Manual checks — synthetic world and oracle

| # | Do | Pass when | Verified by |
|---|---|---|---|
| S1 | Live Session → **Synthetic simulation** → *Structured simulator · profile 0002* → *Create scenario* | No persona form; header shows profile `pcub-profile-0002-23d45e44` as the name, progress "0/12 turns" (plan 2 × 6), and "Synthetic simulation" | UI, E2E, API |
| S2 | *Run 3 turns with simulator reactions* | Three timeline entries; evidence labelled "Synthetic · factual in simulation"; "Simulator internals (post-hoc audit, not predictor input)" disclosure; if a synthetic DISENGAGE appears, the session stays **Open** | UI, E2E, API |
| S3 | *Get recommendation for turn 4* | No reaction form; only "Reveal the simulated reaction" | E2E, Mock |
| S4 | *Open the branch explorer* → oracle checkbox **on** by default → *Run* | Result shows the "Synthetic reference · not human truth" panel with meaning "synthetic-model reference; never human ground truth", two policy values, oracle-best policy and exact tie; metrics include `regret` and `best_policy_correct`, and a sentence states plainly whether the limited selection **agreed** or **disagreed** | UI, E2E, API |
| S5 | Repeat S1–S4 with *Agenda-derived simulator · profile 0002* | Same structure. Agreement and regret **vary by run**: in one captured run the agenda case disagreed (regret ≈ 0.072), but that is one case, not a property to expect | E2E, API |
| S6 | Optional: untick the oracle and run | Oracle and metrics shown as absent | API (oracle:false), Mock |
| S7 | Optional: Synthetic world with the policy set to **Guarded LLM scorer** and predictor **Population** (structured scenario) → *Get recommendation for turn 1* | Either a recorded guarded decision (execution mode `recorded_guarded`, provider live calls 0) or `RECORDED_CONTEXT_UNAVAILABLE`; both are acceptable. A live call is not. In the real-backend integration run of 2026-11-11 this produced a recorded decision. | API only; not clicked through in the browser |
| S8 | Synthetic session → *Run all … remaining turns* (from any open turn without a pending recommendation) | Each step is a separate journaled command; segment 2 starts after turn 6 with segment 1 history kept; after turn 12 the session is **Closed · read-only record** and shows a **Trajectory summary** (each turn's saved forecast and realized reaction, final engineered state) | UI, API (complete 2 × 6 run for both simulators) |

## 5. Manual checks — R1, persistence, accessibility

| # | Do | Pass when | Verified by |
|---|---|---|---|
| R1 | Open `/r1` | Claim shown verbatim; "formal closure present: false"; RQ1 gains negative on both simulators; RQ2 guarded ≈ 42% / 45% vs feedback ≈ 7.5% / 6.7%; RQ3 table without a winner; RQ4 5,100 attempts, 0 unknown, replay network calls 0 | UI, E2E |
| R2 | Look at any session page | No R1 numbers or R1 labels appear | Code review (R1 data is fetched only on `/r1`) |
| P1 | Reload a session page | Same revision, history and pending state | UI, API |
| P2 | Open `/system` | Every request you made is listed, each in its own terminal state: **Committed**; **Rejected by backend (nothing committed)**, e.g. the `NO_SAFE_RECOMMENDATION` or `RECORDED_CONTEXT_UNAVAILABLE` checks above; **Uncertain** (a response may have been lost); **Abandoned**; or **Provider unknown completion** (never retry; not reachable offline). *Recover* appears only on **Uncertain** rows, because replaying an identical request is only meaningful when its outcome is unknown. | UI (journal contents inspected); Mock (Recover) |
| P3 | Note: lists and charts are browser-local | "Your sessions", "Your comparisons", the command journal and state-chart points live in **this browser's storage**. Another browser shows none of them; reopen by id. | by design |
| A1 | Tab from the top of any page | The first stop is "Skip to content", and Enter moves focus to the main area | E2E |
| A2 | Overview: arrow keys on the loop tabs | Selection moves between the five steps | E2E |
| A3 | Narrow the browser to about 375 px | No sideways page scroll on any page; the session page shows Turn / History / State tabs | E2E (overflow only); the Turn / History / State tabs are not tested |

## 5a. Optional live guarded mode (operator-attended; see `../../LIVE_GUARDED_MODE.md`)

Only with a backend started by `scripts/start_live_backend.ps1` (fresh journal, small `-LiveCallLimit`) and a frontend
on the origin it allows (default `http://localhost:5175`). Every real request is a provider call: do these checks
deliberately.

| # | Do | Pass when | Verified by |
|---|---|---|---|
| L1 | Open the app | Header indicator **Live backend connected** only (no status strip, no other live-LLM text, no alarm banner); in a guarded session the permission panel says the model only scores the safe shortlist | Mock, Fake (E2E) |
| L2 | Live Session → Human → choose **Guarded LLM scorer** → *Create scenario* | The policy carries a **LIVE** note; the session shows the *Live guarded LLM scoring* panel; *Get recommendation … (may send 1 live provider request)* is **disabled** | Mock, Fake (E2E), Real (UI) |
| L3 | Tick the acknowledgement → *Allow live provider requests for this session* → *Get recommendation* | One request. Provider work panel: **New live provider decision**, `live_guarded`, live calls 1, new tokens = this decision's total; journal totals; provenance chip *live guarded* | Mock, Fake (API, E2E), Real (UI: 2 decisions; stored responses checked through the API) |
| L4 | The same decision context again (identical persona, request, state and position) | **Live decision reused from the provider journal**, live calls 0, cache reuse *yes: journaled live decision*; same fingerprint and ranking | Fake (API, E2E), Real (API, UI; before and after a backend restart) |
| L5 | Synthetic world with the guarded policy | Only *Run 1 turn* (after permission); *Run 3 turns* and *Run all* stay disabled | Mock, Fake (E2E) |
| L6 | Branch explorer on the live backend | Guarded options disabled with the reason (up to 21 decisions per comparison); a deterministic pair runs with live calls 0 | Mock, Fake (API, E2E) |
| L7 | Unknown completion | `PROVIDER_UNKNOWN_COMPLETION`; journal row *never retry*, no *Recover*; the page stops live requests | Fake only (never triggered against a real provider, by design) |
| L8 | Limit used up | `PROVIDER_BUDGET_OR_WRITER_UNAVAILABLE`, nothing committed, no request | Fake (API), Real (API) |

## 6. Not verified — know before relying on it

- **Lost-response recovery** was tested only with simulated network failures (Mock), not by interrupting the real
  backend mid-request.
- **Stale revision in the UI**: the backend's `STALE_REVISION` is verified (API), and the UI handling is verified with
  Mock. It is hard to trigger by hand, because pages refetch when they regain focus.
- **Live guarded mode** (§5a): verified with the fake-provider harness, and in one controlled real-provider run of two
  decisions (§7; details in `../../LIVE_GUARDED_MODE.md` §8). It has not been used for long sessions, synthetic
  sessions, by several tabs at once, or with any provider other than the one configured for that run. Unknown
  completion and the invalid-answer fallback were exercised with the fake provider only.
- **Guarded policy, recorded path in the browser**: a recorded guarded decision was observed once, through the
  real-backend integration test (structured synthetic fixture, guarded policy, population predictor, 0 live calls). It
  has not been clicked through in the browser, and new human scenarios generally got `RECORDED_CONTEXT_UNAVAILABLE`.
- **Backend restart persistence**: not exercised by the frontend. The backend's own release evidence covers it (MSR §21).
- **Two-tab concurrency**, **very long sessions** (4 × 12) and **visual review of every screen at every width**: not done.
- **Empirical claims**: none. These checks are functional only.

## 7. Verification record

| Date | Commit | Ran | Result |
|---|---|---|---|
| 2026-11-10 | `8dee974` (tree as committed) | typecheck, lint, build, `npm test`, `test:integration`, `test:e2e`, manual browser walk-through (H1–H3, B1–B4, S1–S4, R1) | all passed: 92 / 52 / 18 |
| 2026-11-11 | `8dee974` (clean `integration/pcub-frontend`, before the documentation commits) | Full suite, run independently by the operator: typecheck, lint, `npm test`, `npm run test:integration`, `npm run test:e2e`, build | all passed: 92 / 52 (real offline backend) / 18 |
| 2026-11-11 | `8dee974` | typecheck, lint, `npm test`, build, re-run during development (not an independent run) | all passed: 92 |
| 2026-11-12 | `989acf6` with the publication changes listed in the repository's `SOURCE_IDENTITY.json` | Clean checkout: `npm ci`, typecheck, lint, `npm test`, build, `npm run test:integration`, `npm run test:e2e`, against a freshly installed offline backend (new virtual environment, empty database; backend suite 18 / 18) | all passed: 117 / 52 / 32 |
| 2026-11-15 | `989acf6` with the publication and demo-track changes listed in the repository's `SOURCE_IDENTITY.json` | Clean checkout: `npm ci`, typecheck, lint, `npm test`, build, `npm run test:integration` (now including a complete 2 × 6 run per simulator), `npm run test:e2e`, against a freshly installed offline backend (backend suite 18 / 18); browser walk-through of the human turn, feedback, adaptation, human and synthetic branch comparisons, a full 2 × 6 synthetic run with *Run all remaining turns*, and the R1 archive | all passed: 121 / 54 / 32 |
| 2026-11-15 | `989acf6` with the publication, demo-track and live-guarded changes listed in the repository's `SOURCE_IDENTITY.json` | Clean checkout of the staged release, with the offline suites as in the row above. Live with the fake provider (`scripts/fake_live_backend.py`, a fresh harness and journal per suite): `npm run test:live-fake`, `npm run test:e2e:live-fake`, and `scripts/live_smoke.py --expect fake` (phases `first`, `after-restart`, `budget`). `--expect real` was confirmed to refuse the fake harness | all passed: 132 / 54 / 32; live-fake 8 / 6; smoke 3 / 3 phases |
| 2026-11-15 | same tree | **Real provider**, operator-attended. `start_live_backend.ps1 -LiveCallLimit 2` with a fresh journal. The operator made L2–L3 through the interface: 2 guarded recommendations, turns 1 and 2 of one human session, after granting permission. Then L4 and L8 through the API without provider requests (same-key replay; a clone of the session reusing both decisions; refusal of a new context at the limit), before and after a launcher restart (`R`), and L4 in the interface. Journal records re-verified with the backend's read-only `Journal.get`. Stopped with `Q` | 2 provider calls, both parsed with no fallback, `live_guarded`, 3,136 and 4,343 tokens; 20 / 20 checks before and after the restart; journal 2 reserved / 2 completed / 0 unknown |
| 2026-11-15 | `989acf6` with the publication, demo-track, live-guarded and final-acceptance changes listed in the repository's `SOURCE_IDENTITY.json` | **Final acceptance.** Clean checkout of the staged release: publication verifier, backend source verification and the backend suite; `npm ci`, typecheck, lint, `npm test`, build, `npm run test:integration` and `npm run test:e2e` against a freshly installed offline backend; the live-fake suites and `live_smoke.py --expect fake`. Manual browser pass (built-in browser): Overview and status offline and live (fake provider), Lab form with the disabled allergy/exclusion inputs and diets, two human sessions (recommendation, forecast, Modify with an effort request, Accept, reload persistence, adaptation lens), *Run all* 2 × 6 for both simulators, a pending-root PCUB comparison with oracle, R1, Architecture, Method, System, recorded guarded provenance, the live permission panel, the unreachable-backend state and 375 px. No real provider request was made | all passed: backend 18 / 18; 144 / 54 / 32; live-fake 8 / 6; smoke 3 / 3 phases (`--expect real` refused the fake, as designed); manual checks as listed |

The first three rows are for source commit `8dee974`. The later commits on `docs/user-guide` are documentation-only and
change no application code, so they do not alter those rows. The 2026-11-11 integration run also logged
`guarded synthetic: recorded decision available at turn 1`.

The backend was confirmed `mode: offline`, `live_guarded: false`, asset fingerprint `9ec70fca…f093` on both dates.

**Scope of this record.** It is functional evidence for local use. It does not establish public-hosting readiness,
multi-user isolation or production security: there are no accounts, no per-resource authorisation, no rate limiting
and no cancellable asynchronous jobs.
