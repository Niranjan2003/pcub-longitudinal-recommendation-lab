import type { Session } from '@/api/schemas';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';

/**
 * Plain-language explanation of a synthetic simulation run. The horizon is read
 * from the backend's plan; nothing is computed or assumed here.
 */
export function SyntheticExplainer({ session, collapsed = false }: { session?: Session; collapsed?: boolean }) {
  const plan = session?.plan;
  const horizon = plan
    ? `${plan.number_of_sessions} longitudinal segments × ${plan.turns_per_session} turns (${plan.number_of_sessions * plan.turns_per_session} turns in total)`
    : 'two longitudinal segments of six turns each (12 turns)';
  const points = (
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          <strong>Predefined fixture.</strong> The profile
          {session ? (
            <>
              {' '}
              (<span className="mono">{session.persona.display_name}</span>)
            </>
          ) : null}
          , its request, hard constraints and starting state come from a curated, verified fixture. You do not edit them, and the run is a new simulation, not a
          replay of the historical R1 experiment.
        </li>
        <li>
          <strong>Independent simulator reactions.</strong> After each recommendation, the simulator, not you and not the predictor, generates the reaction from
          private tendencies that the predictor never sees.
        </li>
        <li>
          <strong>Longitudinal horizon.</strong> The plan is {horizon}. History and the engineered state carry over from one segment to the next, and the session
          closes after the last planned turn.
        </li>
        <li>
          <strong>Prediction versus outcome.</strong> Each turn&apos;s forecast is saved <em>before</em> the simulator reacts. The forecast is a prediction; the
          simulator&apos;s reaction is the outcome, factual only inside the simulation. The two can differ.
        </li>
      </ul>
  );
  if (collapsed) {
    return (
      <details className="surface-synthetic p-3">
        <summary className="cursor-pointer select-none font-semibold">How a synthetic simulation works</summary>
        {points}
      </details>
    );
  }
  return (
    <section className="surface-synthetic p-4" aria-labelledby="synthetic-how">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="synthetic-how" className="text-lg">
          How a synthetic simulation works
        </h3>
        <EvidenceLabel tone="synthetic">Synthetic · not human behaviour</EvidenceLabel>
      </div>
      {points}
    </section>
  );
}
