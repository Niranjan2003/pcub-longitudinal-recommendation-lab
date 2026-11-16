import type { Session } from '@/api/schemas';
import { PREDICTOR_LABEL } from '@/domain/ontology';
import { positionLabel } from '@/domain/format';
import { ProbabilityBars } from '@/components/viz/ProbabilityBars';

/**
 * Returned forecast beside the returned population vector, per turn. For the
 * population predictor they coincide by construction. For class_bias and
 * contextual, differences reflect this scenario's adapter state. This is not an
 * accuracy claim, and both vectors are shown exactly as returned.
 */
/** Largest absolute difference between two returned 4-vectors, in percentage points. Display arithmetic on returned values only. */
function largestGapPoints(a: readonly number[], b: readonly number[]): number {
  return Math.max(...a.map((x, i) => Math.abs(x - (b[i] ?? x)))) * 100;
}

function gapText(points: number): string {
  if (points < 0.05) return 'below 0.1 percentage points';
  return `${points.toFixed(1)} percentage points`;
}

export function AdaptationLens({ session }: { session: Session }) {
  const label = PREDICTOR_LABEL[session.predictor]?.label ?? session.predictor;
  const rows = [
    ...session.evidence.map((e) => ({ id: e.forecast.id, pos: e.forecast.predictor_input.position, p: e.forecast })),
    ...(session.pending ? [{ id: session.pending.id, pos: session.pending.predictor_input.position, p: session.pending }] : []),
  ];

  if (session.predictor === 'population') {
    return (
      <section aria-label="Predictor adaptation" className="text-sm">
        <h3 className="text-lg">Forecast model</h3>
        <p className="mt-1 text-muted">
          This scenario uses the <strong>frozen population</strong> model. It does not adapt, so each forecast equals the population reference.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Predictor adaptation" className="text-sm">
      <h3 className="text-lg">Adaptation lens</h3>
      <p className="mt-1 text-muted">
        Per turn: this scenario’s <strong>{label}</strong> forecast beside the <strong>frozen population reference</strong>. A difference reflects this
        scenario’s own adapter state after earlier reveals; it is usually small, and is not an accuracy or personalization claim. The realized reaction is in the
        history.
      </p>
      {rows.length === 0 && <p className="mt-2 text-muted">Appears once the first recommendation exists.</p>}
      <div className="mt-2 space-y-3">
        {[...rows].reverse().slice(0, 4).map((r) => (
          <details key={r.id} open={r.id === rows[rows.length - 1]?.id} className="rounded border border-rule bg-white p-2">
            <summary className="cursor-pointer select-none font-medium">
              Turn {positionLabel(r.pos)} {r.id === session.pending?.id && <span className="text-muted">(pending)</span>}
              <span className="ml-2 text-xs font-normal text-muted">
                largest difference: {gapText(largestGapPoints(r.p.probabilities, r.p.conformal_reference.population_probabilities))}
              </span>
            </summary>
            <div className="mt-2 grid gap-3">
              <ProbabilityBars probabilities={r.p.probabilities} variant="forecast" compact caption={`Current forecast (${label})`} />
              <ProbabilityBars probabilities={r.p.conformal_reference.population_probabilities} variant="plain" compact caption="Frozen population reference" />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
