import { configureApi, postJson } from '@/api/client';
import { getCapabilities, createHumanSession, recommend, submitHumanFeedback } from '@/api/endpoints';
import { isLiveCapable } from '@/state/backendStatus';
import type { Capabilities, Session } from '@/api/schemas';
import type { CreateHumanSessionInput } from '@/api/requests';

/**
 * Real-backend integration helpers. These run the REAL frontend client code
 * (typed endpoints, journal, idempotency, schemas) against a locally running
 * OFFLINE backend. They never start the backend, never touch its files, and
 * ABORT unless the backend reports mode "offline" and live_guarded false.
 */
export const BASE_URL = process.env.PCUB_BACKEND_URL ?? 'http://127.0.0.1:8765';
export const RUN_ID = `it${Date.now().toString(36)}`;

export async function preflight(): Promise<Capabilities> {
  if (process.env.PCUB_REAL_OFFLINE !== '1') {
    throw new Error('Real-backend tests are opt-in. Start the OFFLINE backend yourself, then set PCUB_REAL_OFFLINE=1.');
  }
  configureApi({ baseUrl: BASE_URL });
  const caps = await getCapabilities();
  if (isLiveCapable(caps)) {
    throw new Error(`Refusing to run: backend is live-capable (mode=${caps.mode}, live_guarded=${String(caps.live_guarded)}). Offline only.`);
  }
  return caps;
}

export function personaInput(name: string, overrides: Partial<CreateHumanSessionInput['persona']> = {}): CreateHumanSessionInput['persona'] {
  return {
    user_id: `${RUN_ID}-${name}`,
    display_name: `IT ${name}`,
    dietary_pattern: 'omnivore',
    allergies: ['peanut'],
    excluded_ingredients: [],
    health_goals: [],
    taste_preferences: [],
    ...overrides,
  };
}

export function sessionInput(name: string, extra: Partial<CreateHumanSessionInput> = {}): CreateHumanSessionInput {
  return {
    policy: 'deterministic_recipe_recommendation',
    prediction_backend: 'current_structured_simulator@1',
    predictor: 'contextual',
    persona: personaInput(name),
    request: 'Recommend a safe recipe.',
    segments: 2,
    turns_per_segment: 6,
    ...extra,
  };
}

export async function newSession(name: string, extra: Partial<CreateHumanSessionInput> = {}): Promise<Session> {
  return (await createHumanSession(sessionInput(name, extra))).value;
}

/** create → recommend → feedback, returning the session after the reveal. */
export async function playTurn(
  s: Session,
  reaction: Parameters<typeof submitHumanFeedback>[1]['reaction'] = 'ACCEPT',
  continuation: 'CONTINUE' | 'DISENGAGE' = 'CONTINUE',
): Promise<Session> {
  const pending = (await recommend(s)).value;
  return (
    await submitHumanFeedback(pending, {
      recommendationId: pending.pending!.id,
      reaction,
      continuation,
      requestedChanges: [],
    })
  ).value;
}

export { postJson };
