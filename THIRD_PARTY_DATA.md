# Third-party data, recorded model outputs and licenses

This file lists material in the repository that was **not** authored by the project, or that derives from third-party sources, with its source, ownership and applicable terms.

Third-party materials remain subject to the terms and rights of their original owners. Their inclusion in this research release does not grant additional rights beyond those applicable to the original materials.

## 1. Recipe catalog: HUMMUS / Food.com

| | |
|---|---|
| Files | `backend/assets/catalog/hummus_subset_10000.parquet` (7.2 MB), `backend/assets/catalog/hummus_subset_10000_manifest.json` |
| Upstream | HUMMUS recipe dataset, <https://gitlab.com/felix134/connected-recipe-data-set>, commit `eb67259`, file `pp_recipes.csv` (SHA-256 `795fda95…bdd1e6`). Dataset paper: Bölz et al., "HUMMUS: A Linked, Healthiness-Aware, User-centered and Argument-Enabling Recipe Data Set for Recommendation", RecSys 2023, doi:[10.1145/3604915.3609491](https://doi.org/10.1145/3604915.3609491) |
| Original content | Recipes from **Food.com**: title, description, ingredients, directions, tags, nutrition, aggregate rating, recipe URL |
| Linked identifiers | FoodKG URIs (`http://idea.rpi.edu/heals/kb/...`) in `food_kg_locator` and `ingredient_food_kg_urls` |
| Preparation | Project-prepared subset. Upstream records were parsed, validated, deduplicated and filtered (including removal of non-food and pet-food records), and organized into structured fields such as parsed ingredient, direction and tag lists, normalized ingredient names, per-serving nutrition fields, ingredient and instruction counts, and data-quality flags |
| Selection | Deterministic, stratified, food-only subset of 10,000 recipes; seed and filtering rules are in the manifest |
| Personal data | The subset has no author IDs, user IDs or reviews. Ratings appear only as aggregates (`average_rating`, `number_of_ratings`). The free-text recipe descriptions are unchanged from upstream: three contain an e-mail address written by the recipe's author (one spelled out in words), and one contains a company's toll-free phone number. |

**License notes recorded when the subset was created** (`license_use_notes` in the manifest):

- "Food.com data may only be used for educational or scientific purposes according to the HUMMUS repository README."
- "Repository code is licensed under GPLv3 according to the HUMMUS repository README."

**Use in this release.** The prepared subset is used in the recorded research setup for educational or scientific purposes only. Its recipe text originates from Food.com, and the terms and rights attached to the HUMMUS dataset and to the original Food.com content continue to apply.

The backend checks the catalog's exact bytes and ordered recipe-ID fingerprint, so it will not start without this file.

**Derived copies of recipe content** (titles, ingredients, directions, descriptions or URLs) also appear in:

- `backend/assets/golden/fixtures/reference/*.json`, especially `turns_*`, `branches_*`, `H3_completion.json` and `H17_completion.json`;
- `backend/assets/golden/recorded_decisions/**`, in candidate lists inside prompts;
- `frontend/tests/fixtures/captured/*.json`;
- occasional recipe titles quoted as examples in `backend/docs/MASTER_SYSTEM_REPORT.md`.

The aggregate files in `backend/assets/reference-results/` contain no recipe text.

The same terms apply to these copies.

## 2. Recorded LLM requests and responses

| | |
|---|---|
| Files | `backend/assets/golden/recorded_decisions/` (77 decision records, plus `requests/` and `responses/`, 77 each) and `backend/assets/golden/recorded_decision_subset_manifest.json` |
| Provider | Institutional OpenAI-compatible endpoint, labeled `lehmus` in the records; response model label `cm-llm`; an opaque requested-deployment identifier |
| Content | Full prompts; full `chat.completion` response bodies, including the model's free-text **reasoning** field (about 4,800 characters on average); token usage; latencies; timestamps |
| Credentials | None. Records hold no API keys, endpoints or authorization headers. The capture environment record states `credentials_removed: true`. |

These recorded outputs are the offline "closure" that lets the guarded-LLM policy and the golden tests run without network access. The backend verifies their hashes.

**Use in this release.** The recorded outputs are retained as part of the research evidence. The provider's and the model's terms continue to apply.

## 3. Simulator lineage

`usersimcrs_agenda_derived@1` is described in the reports as an agenda-derived food-domain adaptation, "not the full official UserSimCRS simulator". Its implementation is project code, inspired by agenda-based user simulation in UserSimCRS (<https://github.com/iai-group/UserSimCRS>). No UserSimCRS package or vendored UserSimCRS source is included.

## 4. Software dependencies (not vendored)

No third-party code is committed. Dependencies are installed from public registries at the pinned versions:

- **Python:** `backend/requirements.txt` lists numpy (BSD-3-Clause), pandas (BSD-3-Clause), pydantic (MIT) and pyarrow (Apache-2.0), plus their transitive dependencies.
- **JavaScript:** `frontend/package.json` and `frontend/package-lock.json` list React, TanStack Query, Radix UI, zod, Vite, Vitest, Playwright and others. Most are MIT, ISC or Apache-2.0.
- **Fonts:** IBM Plex Sans, Serif and Mono via `@fontsource/*` are under the SIL Open Font License 1.1.

A production build (`frontend/dist/`) bundles these fonts and libraries. Anyone distributing build output must include their license notices. Build output is not committed.

## 5. Project-generated research artifacts

The following were produced by the project itself, not taken from third parties:

- the frozen model bundles (`assets/models/`) and allocator weights (`assets/weights/`);
- the configuration (`assets/configuration/`);
- the golden reference fixtures;
- the historical R1 reference results (`assets/reference-results/`);
- the release evidence.

They contain or derive from the third-party material above wherever they embed recipe content or LLM outputs. All user profiles in them are synthetic (for example `pcub-profile-0002`). There is no real participant data.

## 6. Project license

The project's own code, documentation and research artifacts are not currently released under an open-source license; default copyright applies. A project license would cover only the project's own material, not the third-party material listed above.
