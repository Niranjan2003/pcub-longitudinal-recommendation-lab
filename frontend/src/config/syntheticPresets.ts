/**
 * Operator-verified synthetic scenario presets.
 *
 * The API has NO fixture-listing endpoint, so these basenames are a curated,
 * verified list, never discovered or guessed at runtime. Each entry was
 * verified on 2026-11-10 against the local OFFLINE backend by creating a
 * synthetic session (HTTP 200, revision 0) with the matching simulator backend.
 * A missing or mismatched name produces a backend error (a missing file was
 * observed to return HTTP 500), so nothing outside this list is ever sent.
 *
 * Creating a session from a fixture is NOT an exact replay of the historical
 * R1 run: the backend assigns a new scenario identity and seed namespace.
 */
export interface SyntheticPreset {
  id: string;
  title: string;
  blurb: string;
  fixture: string;
  /** The simulator backend this fixture is compatible with. */
  backend: string;
  /** The fixture's profile id, as documented. */
  profileId: string;
  verified: string;
}

export const SYNTHETIC_PRESETS: readonly SyntheticPreset[] = [
  {
    id: 'structured-profile-0002',
    title: 'Structured simulator · profile 0002',
    blurb: 'Private tendencies drive four-class reaction probabilities; reactions are drawn from them. Plan: 2 segments × 6 turns.',
    fixture: 'trajectory_pcub-v3-current_structured_simulator@1-pcub-v1-pcub-profile-0002-23d45e44-deterministic_recipe_recommendation-v1.json',
    backend: 'current_structured_simulator@1',
    profileId: 'pcub-profile-0002-23d45e44',
    verified: '2026-11-10',
  },
  {
    id: 'agenda-profile-0002',
    title: 'Agenda-derived simulator · profile 0002',
    blurb: 'A food-domain adaptation of an agenda-based simulator; its reaction vector is one-hot. Plan: 2 segments × 6 turns.',
    fixture: 'trajectory_pcub-v3-usersimcrs_agenda_derived@1-pcub-v1-pcub-profile-0002-23d45e44-deterministic_recipe_recommendation-v1.json',
    backend: 'usersimcrs_agenda_derived@1',
    profileId: 'pcub-profile-0002-23d45e44',
    verified: '2026-11-10',
  },
];
