import { useState } from 'react';
import { Link } from 'react-router';
import { EvidenceLabel } from '@/components/evidence/EvidenceLabel';
import { MECHANISMS, type Avail, type Mechanism } from './evaluationModel';

/**
 * Evaluation map — ONLY mechanisms that are implemented and supported now.
 * Availability per evidence world, what each compares, where it is shown, and
 * what it does not establish. Static documentation; no values.
 */
const AVAIL_TEXT: Record<Avail, string> = { yes: 'Available', no: 'Not available', aggregate: 'Historical aggregate' };

function Mark({ a }: { a: Avail }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {a === 'yes' && (
        <svg width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="#1d232b" />
        </svg>
      )}
      {a === 'no' && (
        <svg width="14" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="12" y2="7" stroke="#5a626c" strokeWidth="2" />
        </svg>
      )}
      {a === 'aggregate' && (
        <svg width="14" height="14" aria-hidden="true">
          <rect x="1.5" y="1.5" width="11" height="11" fill="#f3ede1" stroke="#6b5a2d" />
        </svg>
      )}
      <span className="text-xs">{AVAIL_TEXT[a]}</span>
    </span>
  );
}

const LABEL: Record<Mechanism['tone'], string> = {
  pending: 'Forecast',
  human: 'Factual',
  synthetic: 'Synthetic',
  hypothetical: 'Hypothetical',
  oracle: 'Synthetic reference',
  archive: 'Frozen R1',
  neutral: 'Record',
};

export function EvaluationMap() {
  const [sel, setSel] = useState<string>('forecast');
  const m = MECHANISMS.find((x) => x.id === sel)!;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm">
        Only evaluation mechanisms that are implemented and supported now. Columns show where each is available. Interactive human and synthetic evidence and
        frozen historical R1 results are never mixed: R1 only ever appears as its own aggregate tables.
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <caption className="sr-only">Implemented evaluation mechanisms and where they are available</caption>
            <thead>
              <tr className="border-b-2 border-ink text-xs">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Mechanism
                </th>
                <th scope="col" className="border-l border-rule px-3 py-2 font-semibold">
                  <span className="border-l-4 border-human pl-1.5">Interactive human</span>
                </th>
                <th scope="col" className="border-l border-rule px-3 py-2 font-semibold">
                  <span className="border-l-4 border-synthetic pl-1.5">Interactive synthetic</span>
                </th>
                <th scope="col" className="border-l-4 border-double border-[#cdbf9f] bg-archive px-3 py-2 font-semibold">
                  Frozen historical R1
                </th>
              </tr>
            </thead>
            <tbody>
              {MECHANISMS.map((x) => (
                <tr key={x.id} className={`border-b border-rule ${sel === x.id ? 'bg-[#fffdf6]' : ''}`}>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <button
                      type="button"
                      aria-pressed={sel === x.id}
                      onClick={() => setSel(x.id)}
                      className={`w-full border-l-4 py-1 pl-2 text-left ${sel === x.id ? 'border-ink font-semibold' : 'border-transparent hover:border-rule'}`}
                    >
                      {x.title}
                      <span className="mono ml-2 text-[10px] uppercase tracking-wide text-muted">{LABEL[x.tone]}</span>
                    </button>
                  </th>
                  <td className="border-l border-rule px-3 py-2">
                    <Mark a={x.human} />
                  </td>
                  <td className="border-l border-rule px-3 py-2">
                    <Mark a={x.synthetic} />
                  </td>
                  <td className="border-l-4 border-double border-[#cdbf9f] bg-archive/60 px-3 py-2">
                    <Mark a={x.r1} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="surface p-5 xl:sticky xl:top-4 xl:self-start" aria-live="polite" aria-labelledby="eval-title">
          <EvidenceLabel tone={m.tone === 'neutral' ? 'neutral' : m.tone}>{LABEL[m.tone]}</EvidenceLabel>
          <h3 id="eval-title" className="mt-2 text-2xl">
            {m.title}
          </h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">What it compares or records</dt>
              <dd className="m-0">{m.compares}</dd>
            </div>
            <div>
              <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Produced by</dt>
              <dd className="m-0">{m.produced}</dd>
            </div>
            {m.r1Note && (
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">In the frozen R1 archive</dt>
                <dd className="m-0">{m.r1Note} Shown only on the R1 page, never mixed with interactive results.</dd>
              </div>
            )}
            <div>
              <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Does not establish</dt>
              <dd className="m-0">{m.notEstablished}</dd>
            </div>
          </dl>
          <Link to={m.where.to} className="btn mt-4 !min-h-8 !px-3 !py-1 text-sm no-underline">
            {m.where.label} →
          </Link>
        </aside>
      </div>
    </div>
  );
}
