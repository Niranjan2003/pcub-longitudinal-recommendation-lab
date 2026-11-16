import type { ReactNode } from 'react';
import type { Provenance, WorldKind } from '@/api/schemas';
import { WORLD_META } from '@/domain/ontology';

type Tone = 'pending' | 'human' | 'synthetic' | 'hypothetical' | 'oracle' | 'archive' | 'neutral' | 'danger' | 'warn' | 'ok';

const TONE: Record<Tone, string> = {
  pending: 'text-ink',
  human: 'text-human',
  synthetic: 'text-synthetic',
  hypothetical: 'text-[#3d6078]',
  oracle: 'text-ink',
  archive: 'text-[#6b5a2d]',
  neutral: 'text-muted',
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
};

export function EvidenceLabel({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`evidence-label ${TONE[tone]}`} title={title}>
      {children}
    </span>
  );
}

/** World of an evidence object. Text always accompanies the colour rule. */
export function WorldBadge({ world }: { world: WorldKind }) {
  const m = WORLD_META[world];
  const tone: Tone = m.surface === 'human' ? 'human' : m.surface === 'synthetic' ? 'synthetic' : 'archive';
  return (
    <EvidenceLabel tone={tone} title={m.note}>
      {m.label}
    </EvidenceLabel>
  );
}

const STATUS_TEXT: Record<Provenance['evidence_status'], string> = {
  pending: 'Forecast · pending',
  factual: 'Factual',
  counterfactual: 'Hypothetical · counterfactual',
};

const EXEC_TEXT: Record<Provenance['recommendation_execution_mode'], string> = {
  deterministic: 'deterministic policy, no provider',
  recorded_guarded: 'guarded LLM decision from the recorded set, no live provider call',
  live_guarded: 'guarded LLM decision from a live provider response (new, or reused from the provider journal)',
};

/** Provenance chips, rendered verbatim from the backend's provenance object. */
export function ProvenanceChips({ provenance }: { provenance: Provenance }) {
  const statusTone: Tone = provenance.evidence_status === 'pending' ? 'pending' : provenance.evidence_status === 'counterfactual' ? 'hypothetical' : 'ok';
  const execTone: Tone = provenance.recommendation_execution_mode === 'live_guarded' ? 'danger' : 'neutral';
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Provenance">
      <WorldBadge world={provenance.world_kind} />
      <EvidenceLabel tone={statusTone} title={`evidence_status: ${provenance.evidence_status}`}>
        {STATUS_TEXT[provenance.evidence_status]}
      </EvidenceLabel>
      <EvidenceLabel tone="neutral" title="reaction_origin">
        origin: {provenance.reaction_origin ?? 'none yet'}
      </EvidenceLabel>
      <EvidenceLabel tone={execTone} title={`recommendation_execution_mode: ${EXEC_TEXT[provenance.recommendation_execution_mode]}`}>
        {provenance.recommendation_execution_mode.replace('_', ' ')}
      </EvidenceLabel>
    </div>
  );
}
