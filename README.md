# PCUB Research Testbed: Longitudinal Food Recommendation

A research testbed for studying how food recommendation policies behave when a recommendation has consequences beyond the current turn. Each recommendation gets a reaction. The reaction becomes history and changes an explicit simulated state, so later recommendations and forecasts operate on a different context. The object of study is a **trajectory** of interactions, not a single ranking.

The research method is **Personalized Calibrated User Branching (PCUB)**. PCUB decides which hypothetical user reactions to expand when comparing two existing recommendation policies. It does not generate recipes.

The recipe catalog is a project-prepared subset of the HUMMUS / Food.com dataset (Bölz et al., RecSys 2023). The research release also includes recorded model outputs. See [Data, third-party material and licensing](#data-third-party-material-and-licensing) for provenance, citation and terms.

## Repository layout

| Path | What it is |
|---|---|
| [`backend/`](backend/) | Python 3.12 scientific engine and local HTTP API (nine `/v1` endpoints, loopback only). It holds the frozen model assets, the 10,000-recipe catalog, the golden reference fixtures, the recorded LLM decisions and the release evidence. |
| [`frontend/`](frontend/) | React + TypeScript research interface (Vite). It renders backend responses and computes no scientific values. It keeps human, synthetic, hypothetical, oracle and historical evidence visibly separate. |
| [`SETUP.md`](SETUP.md) | Installation, verification and run instructions for Windows, macOS and Linux. |
| [`SOURCE_IDENTITY.json`](SOURCE_IDENTITY.json) | Source-identity manifest: the frontend source commit, the backend's sealed fingerprints, the SHA-256 of every source-derived file, the files modified or excluded for publication, and the reasons. |
| [`scripts/verify_publication.py`](scripts/verify_publication.py) | Standard-library verifier that checks this tree against `SOURCE_IDENTITY.json` and the backend's own sealed manifests. |
| [`THIRD_PARTY_DATA.md`](THIRD_PARTY_DATA.md) | Third-party data, recorded model outputs, dependency licenses and upstream terms. |

## Research vision and the implemented system

The research vision is a **longitudinal multi-agent conversational recommender**: recommender, user, behavior-prediction, memory and evaluation agents holding a food conversation over many sessions, with counterfactual evaluation of what would have happened under another policy.

This repository implements a **controlled, bounded testbed** derived from that vision:

| Vision | Implemented here |
|---|---|
| Free natural-language conversation | Structured turns: one of four reaction labels, a continue/disengage flag and optional typed change requests. Free text is stored but never interpreted as a reaction. |
| Several autonomous LLM agents | Deterministic or statistical modules in five functional agent roles, coordinated by a session orchestrator. The only language-model component is the optional guarded scorer policy. |
| A model of user psychology | Six engineered state variables moved by a fixed transition rule. They are not measurements of anyone. |
| Validated behavior prediction | Frozen predictors fitted to synthetic reference data. No human validation has been done. |
| A ground-truth oracle | No human oracle. The only oracle is an exhaustive calculation inside the synthetic simulators. |
| A deployed service | A single-machine local application with no accounts. |

[`backend/docs/MASTER_SYSTEM_REPORT.md`](backend/docs/MASTER_SYSTEM_REPORT.md) §3 and [`frontend/docs/USER_GUIDE.md`](frontend/docs/USER_GUIDE.md) §1 explain this boundary in detail.

## What the system implements

- **Four recommendation policies:** deterministic, constraint-only baseline, feedback-sequence, and a guarded LLM scorer. The guarded scorer only scores a safe deterministic shortlist.
- **A hard-constraint gate** that runs before every policy. It refuses candidate windows with no compatible recipe rather than relaxing constraints. It is approximate keyword screening and numeric limits, not dietary compliance or allergy safety: multi-word and plural forms are not matched, so this release's interface disables allergy and exclusion inputs and the pescatarian pattern (see `frontend/docs/SCIENTIFIC_INTERPRETATION.md` §10).
- **Three factual-session predictors:** `population`, `class_bias` and `contextual`. They forecast a four-class reaction (`ACCEPT`, `MODIFY_CLARIFY`, `DEFER`, `REJECT`) before the outcome is revealed.
- **Two synthetic outcome backends:** a structured simulator and an agenda-derived food-domain adaptation (not the official UserSimCRS runtime).
- **Paired depth-2 counterfactual branching** with four allocators (`equal`, `greedy`, `uncertainty`, `pcub`) and budgets 2, 4, 8 and 12.
- **A separate exhaustive synthetic oracle**, plus conformal prediction-set diagnostics.
- **A transactional local service:** SQLite store, idempotency keys, session revisions, and a durable provider journal for live LLM calls.
- **The frozen historical R1 results**, served read-only and kept separate from new interactive sessions.

## What it does not claim

- No human validation study. The six state dimensions are engineered simulation variables, not measured psychology.
- No demonstrated positive utility gain from guarded LLM scoring. The historical R1 result for that comparison is negative.
- No universal superiority of PCUB. The repository keeps a captured adverse case in which PCUB chose the worse policy.
- Conformal sets are frozen synthetic diagnostics. They give no human coverage guarantee and never prune branches.
- The historical R1 program is **not formally closed**.
- The server is a loopback research tool, not a hosted or multi-user service. It has no accounts, rate limiting or TLS.

[`backend/docs/MASTER_SYSTEM_REPORT.md`](backend/docs/MASTER_SYSTEM_REPORT.md) §29 and [`frontend/docs/SCIENTIFIC_INTERPRETATION.md`](frontend/docs/SCIENTIFIC_INTERPRETATION.md) §9 give the full list of limitations.

## Quick start

Requirements: Python **3.12.10** (pinned in `backend/pyproject.toml`) and Node.js **≥ 22.12**. On Windows, enable Git long-path support before cloning, or clone into a short directory (see [`SETUP.md`](SETUP.md) §1). Full instructions, including Windows PowerShell, are in [`SETUP.md`](SETUP.md).

```bash
python scripts/verify_publication.py           # check the checkout first

# Backend, offline mode (terminal 1)
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B tools/verify_source.py
DEMO_FRONTEND_ORIGIN=http://localhost:5173 \
  .venv/bin/python -B -m demo_backend.api.server --assets assets --database runtime/demo.sqlite3 --port 8765

# Frontend (terminal 2)
cd frontend
npm ci
npm run dev                                     # open http://localhost:5173
```

## Offline, recorded and live behavior

- **Offline (the supported mode).** Without `--live`, the backend makes no network calls. Every policy except the guarded LLM scorer runs normally, and `GET /v1/capabilities` reports `"mode": "offline"`.
- **Recorded guarded decisions.** Offline, the guarded LLM scorer can answer only the **77 exact decision contexts** recorded from earlier provider calls. Those requests return the recorded decision with execution mode `recorded_guarded` and zero live calls. Any other guarded request returns `RECORDED_CONTEXT_UNAVAILABLE`, and no other policy is substituted. The golden tests use these recordings to reproduce the historical guarded behavior.
- **Live guarded mode (optional, operator-attended).** Started with `scripts/start_live_backend.ps1`, which uses the backend's own `--live`, `--journal` and `--live-call-limit` options with an operator-supplied endpoint and token. The guarded LLM then scores the safe shortlist of contexts that are neither recorded nor journaled, with **one provider request per explicit click**. The interface:
  - requires per-session permission before the first request;
  - shows provider accounting and cache reuse for every recommendation;
  - disables multi-turn runs and guarded branch comparisons in live mode;
  - never handles credentials.

  No backend file was changed for this. The workflow was verified with a fake in-process provider, and in one controlled real-provider run of two decisions: both were parsed without fallback, both are reused from the journal across a restart with no new request, and the call limit was enforced. See [`LIVE_GUARDED_MODE.md`](LIVE_GUARDED_MODE.md) §8.

## Runtime state

The backend creates its SQLite stores on demand under `backend/runtime/` (for example `runtime/demo.sqlite3`), at the path given by `--database`. That directory, all `*.sqlite3` files and any provider journal are git-ignored.

The repository deliberately ships **no** runtime databases, session histories or provider journal from the original workstation. A fresh checkout starts with an empty session store. The integration and browser tests write scratch sessions and comparison jobs into whichever database the running backend uses, so use a disposable one.

## Verification

| Command (see `SETUP.md`) | What it checks | Expected |
|---|---|---|
| `python scripts/verify_publication.py` | Every source-derived file matches `SOURCE_IDENTITY.json`; unmodified frontend files match their Git blobs at the source commit; the backend ledger, asset and capture seals hold; the original reference-snapshot hashes match. | `OK` |
| `python -B tools/verify_source.py` (in `backend/`) | The 87 source, test, tool and configuration files match `implementation_ledger.json` and parse. | verified |
| `python -B -m unittest discover -s tests -t . -v` (in `backend/`) | Scientific golden parity, service and HTTP contract, journal safety. | 18 tests pass |
| `npm run typecheck`, `npm run lint`, `npm run build` (in `frontend/`) | Types, lint rules (including a ban on science math in the client), production build. | exit 0 |
| `npm test` (in `frontend/`) | Unit and component tests with mocked responses, including the live-mode workflow and the constraint-control and display repairs. | 144 pass |
| `npm run test:integration` (in `frontend/`) | The real client against a running **offline** backend, including a complete 2 × 6 synthetic run per simulator. | 54 pass |
| `npm run test:e2e` (in `frontend/`) | Playwright browser acceptance (Microsoft Edge): accessibility, 375 px layouts, human and synthetic flows. | 32 pass |
| `npm run test:live-fake`, `npm run test:e2e:live-fake` (in `frontend/`) | The live guarded workflow against the unmodified backend in live mode with a fake in-process provider (`scripts/fake_live_backend.py`); no network. See `LIVE_GUARDED_MODE.md` §5. | 8 and 6 pass |

Passing tests is engineering evidence that the software reproduces its recorded behavior. It is not empirical validation of the research claims.

The recorded evidence was produced with CPython 3.12.10 on Windows. On other platforms, live guarded mode and the two journal tests need the Windows file-locking module (`msvcrt`), and the exact-equality golden comparisons can fail on last-bit floating-point differences.

## Documentation

| Document | Contents |
|---|---|
| [`backend/docs/MASTER_SYSTEM_REPORT.md`](backend/docs/MASTER_SYSTEM_REPORT.md) | Authoritative explanation of the research design, implemented behavior, evidence classes and limitations (31 sections). |
| [`backend/docs/CODE_ARCHITECTURE_REFERENCE.md`](backend/docs/CODE_ARCHITECTURE_REFERENCE.md) | File-by-file code audit, formulas, call graphs, persistence and error semantics (about 7,000 lines). |
| [`frontend/docs/USER_GUIDE.md`](frontend/docs/USER_GUIDE.md) | How to use the research interface. |
| [`frontend/docs/SCIENTIFIC_INTERPRETATION.md`](frontend/docs/SCIENTIFIC_INTERPRETATION.md) | How to read each result, and what it does not show. |
| [`frontend/docs/RUNNING_LOCALLY.md`](frontend/docs/RUNNING_LOCALLY.md) | Guided 10-minute demonstration and troubleshooting. |
| [`LIVE_GUARDED_MODE.md`](LIVE_GUARDED_MODE.md) | The optional live guarded LLM scoring workflow: boundaries, operator procedure, verification and the controlled real-provider run. |
| [`frontend/docs/OPERATOR_VERIFICATION_CHECKLIST.md`](frontend/docs/OPERATOR_VERIFICATION_CHECKLIST.md) | Manual checks with expected results, and the dated verification record. |
| [`frontend/docs/OBSERVED_CONTRACT_NOTES.md`](frontend/docs/OBSERVED_CONTRACT_NOTES.md) | Observed API behavior that differs from, or adds to, the archived contract. |
| [`frontend/docs/reference/`](frontend/docs/reference/) | Reference snapshot of the backend reports and the archived nine-endpoint API contract. |
| [`backend/assets/golden/CAPTURE_REPORT.md`](backend/assets/golden/CAPTURE_REPORT.md) | Golden reference-capture report. |
| [`backend/release_evidence/`](backend/release_evidence/) | Recorded release evidence: test output, package versions, offline capabilities, restart-persistence check. Several files are UTF-16 encoded. |

**Archived reconstruction manual (not included).** The backend's implementation ledger (`creation_document` fields) and the two reports refer to an archived reconstruction manual: numbered phase documents `docs/01.md`–`docs/09.md` and later, a scientific migration ledger and an earlier API contract. That archive was not part of either source and is not in this repository. It is not needed to build, run, test or interpret the current system. Current behavior is documented by the source code, this README, `SETUP.md`, the user guide, the scientific-interpretation reference, and the master and code-architecture reports.

## Source identity and provenance

This tree was assembled from two working directories without modifying them:

- **Frontend:** Git commit `989acf6d34096b438723f5b13f387e8f73b8fcb6` (branch `integration/pcub-frontend`), extracted from Git objects. 81 published files are byte-identical to their committed blobs. 45 files were changed and 12 added for publication: a test-locator fix, optional port overrides, a generalized ignore pattern, documentation updates, the demo interface changes (the "Live Session" label, the synthetic-simulation explanation, *Run all remaining turns* and the trajectory summary), the gated live guarded workflow (`LIVE_GUARDED_MODE.md`), interface refinements (disabled allergy/exclusion inputs and unsupported diets, display-only presentation fixes; `frontend/docs/SCIENTIFIC_INTERPRETATION.md` §10) and a presentation update (neutral connection status, regrouped forms, recipe-first layout, comparison summary), with their tests. `SOURCE_IDENTITY.json` lists each one, with its source blob where there is one, and the reason.
- **Backend:** not a Git repository. It is identified by its own sealed manifests. Every published backend file is byte-identical to its source:
  - implementation ledger SHA-256 `6c3c614b…4086` (87 files);
  - operational asset subset fingerprint `9ec70fca…f093` (320 files);
  - golden-capture fingerprint `368727191a…f0b6`;
  - historical reference repository HEAD `45c58e73…1704a`.

The publication leaves out:

- local development-environment files (editor and tool settings, and working notes);
- machine-specific configuration;
- local SQLite databases and the provider journal;
- the virtual environment, `node_modules` and build output.

`SOURCE_IDENTITY.json` records every excluded tracked file with its hash and the reason.

**Paths in provenance records.** Some provenance records contain absolute Windows paths from the original workstation:

- the `source` fields of `backend/asset_migration.json` and `backend/assets/subset_manifest.json`;
- golden-capture metadata;
- the inspection notes in the two reports.

These paths are historical provenance, not configuration, and nothing in this repository reads them at run time. They are kept unchanged because editing them would break the SHA-256 seals the backend verifies at start-up, or the recorded hashes of the reports.

**Line endings.** `.gitattributes` disables line-ending conversion under `backend/`. Without it, a `core.autocrlf` checkout would change hashed files and the backend would refuse to start.

## Data, third-party material and licensing

### Recipe data: HUMMUS / Food.com

PCUB uses a project-prepared 10,000-recipe subset derived from the main HUMMUS / Food.com dataset. The upstream records were processed to extract, normalize and organize additional information required by the PCUB system and experiments. The preparation procedure (source file, filtering rules, food-only classification, stratified sampling and random seed) and the catalog identity are recorded in the catalog manifest, [`hummus_subset_10000_manifest.json`](backend/assets/catalog/hummus_subset_10000_manifest.json).

The underlying recipe data were collected from Food.com and are used here for educational or scientific purposes only. The original recipes and the HUMMUS dataset were not created by this project. Recipe text from the subset also appears in the test fixtures.

**Citation.** Bölz et al., "HUMMUS: A Linked, Healthiness-Aware, User-centered and Argument-Enabling Recipe Data Set for Recommendation", RecSys 2023. DOI: [10.1145/3604915.3609491](https://doi.org/10.1145/3604915.3609491). Dataset repository: <https://gitlab.com/felix134/connected-recipe-data-set>.

### Recorded model outputs and simulator lineage

The release includes **77 recorded LLM request/response pairs**, including model reasoning text, from an institutional OpenAI-compatible provider, retained as part of the research evidence.

The agenda-derived simulator is project code, inspired by agenda-based user simulation in [UserSimCRS](https://github.com/iai-group/UserSimCRS). No UserSimCRS package or vendored UserSimCRS source is included.

### Rights and licensing

Third-party materials remain subject to the terms and rights of their original owners. Their inclusion in this research release does not grant additional rights beyond those applicable to the original materials.

The project's own code, documentation and research artifacts are not currently released under an open-source license; default copyright applies.

[`THIRD_PARTY_DATA.md`](THIRD_PARTY_DATA.md) gives the source, ownership and terms of each item.
