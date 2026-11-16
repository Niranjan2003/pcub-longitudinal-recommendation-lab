import type { PersonaInput } from '@/api/requests';

/**
 * Pseudonymous example personas. They are conveniences, fully editable, not
 * data about real people. No allergy or exclusion is declared: those inputs are
 * disabled in this release (see LabPage). Each is only a starting form; the backend decides
 * what is recommended (and may truthfully report NO_SAFE_RECOMMENDATION).
 */
export interface HumanPreset {
  id: string;
  title: string;
  blurb: string;
  persona: Omit<PersonaInput, 'user_id'>;
  request: string;
}

export const HUMAN_PRESETS: readonly HumanPreset[] = [
  {
    id: 'vegetarian-quick',
    title: 'Vegetarian · ≤30 min total time',
    blurb: 'Approximate vegetarian keyword screening and at most 30 minutes total recipe time.',
    persona: {
      display_name: 'Example persona A',
      dietary_pattern: 'vegetarian',
      allergies: [],
      excluded_ingredients: [],
      health_goals: [],
      taste_preferences: [],
      max_total_time_minutes: 30,
    },
    request: 'Recommend a quick dinner.',
  },
  {
    id: 'omnivore-open',
    title: 'Omnivore · no hard limits',
    blurb: 'No dietary rule and no limits: the full 48-recipe window each turn.',
    persona: {
      display_name: 'Example persona B',
      dietary_pattern: 'omnivore',
      allergies: [],
      excluded_ingredients: [],
      health_goals: [],
      taste_preferences: [],
    },
    request: 'Recommend a recipe for today.',
  },
  {
    id: 'vegan-simple',
    title: 'Vegan · ≤10 ingredients',
    blurb: 'Approximate vegan keyword screening and at most 10 ingredients.',
    persona: {
      display_name: 'Example persona C',
      dietary_pattern: 'vegan',
      allergies: [],
      excluded_ingredients: [],
      health_goals: [],
      taste_preferences: [],
      max_ingredient_count: 10,
    },
    request: 'Recommend a simple plant-based meal.',
  },
];
