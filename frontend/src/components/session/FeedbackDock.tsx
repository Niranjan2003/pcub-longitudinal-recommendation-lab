import { useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { CHANGE_DIMENSIONS, REACTIONS, type ChangeDimension, type Continuation, type Reaction } from '@/api/schemas';
import type { RequestedChangeInput } from '@/api/requests';
import { REACTION_META } from '@/domain/ontology';
import { ReactionMark } from '@/components/viz/ReactionMark';

interface ChangeRow {
  id: number;
  dimensions: ChangeDimension[];
  instruction: string;
}

export interface FeedbackSubmit {
  reaction: Reaction;
  continuation: Continuation;
  requestedChanges: RequestedChangeInput[];
}

/**
 * Structured human feedback. The reaction you choose is exactly what is
 * recorded. Requested changes are typed notes; the backend never infers a
 * reaction from free text. Keyed by the pending recommendation id so it resets
 * for each new turn.
 */
/**
 * What a requested change actually does, per policy, as implemented in the
 * backend (recommendation/feedback.py, recommendation/prompt.py,
 * prediction/base_features.py, simulation/transition.py). Nothing here
 * interprets text.
 */
const CHANGE_EFFECT: Record<string, string> = {
  feedback_sequence_recipe_recommendation:
    'This session’s policy (feedback-sequence) uses the health and effort ticks, each counted at most three times. Novelty only penalizes repeating the exact same recipe, which does not occur in a normal session.',
  guarded_llm_score_vector: 'This session’s policy (guarded LLM) sees the ticks and instruction text of recent turns, but only re-scores the backend’s safe shortlist.',
  deterministic_recipe_recommendation: 'This session’s policy (deterministic) ignores requested changes.',
  constraint_only_baseline: 'This session’s policy (constraint-only) ignores requested changes.',
};

export function RequestedChangeEffect({ policy }: { policy?: string }) {
  return (
    <div className="mt-1 text-xs text-muted">
      <p>
        <strong>What a requested change does:</strong> it is stored with your reaction. It never changes the hard constraints, and typing a request does not by
        itself change the next recommendation.
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          <strong>Health and effort ticks</strong> are structured feedback used by the feedback-sequence policy.
        </li>
        <li>
          <strong>Instruction text and the other ticks</strong> are recorded; the ordinary policies do not interpret them.
        </li>
        <li>
          <strong>The guarded LLM</strong> receives ticks and text from recent turns as context.
        </li>
      </ul>
      {policy && CHANGE_EFFECT[policy] && <p className="mt-1">{CHANGE_EFFECT[policy]}</p>}
      <p className="mt-1">The forecast model receives how often each dimension was requested.</p>
    </div>
  );
}

export function FeedbackDock({ onSubmit, busy, policy }: { onSubmit: (f: FeedbackSubmit) => void; busy: boolean; policy?: string }) {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [continuation, setContinuation] = useState<Continuation>('CONTINUE');
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rowsInvalid = rows.some((r) => r.instruction.trim().length === 0);
  const canSubmit = reaction !== null && !rowsInvalid && !busy;

  function build(): FeedbackSubmit | null {
    if (!reaction) return null;
    return {
      reaction,
      continuation,
      requestedChanges: rows.map((r) => ({ dimensions: r.dimensions, instruction: r.instruction.trim() })),
    };
  }

  function submit() {
    const f = build();
    if (f) onSubmit(f);
  }

  return (
    <form
      className="surface-human p-4"
      aria-label="Submit your reaction"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        if (continuation === 'DISENGAGE') setConfirmOpen(true);
        else submit();
      }}
    >
      <h3 className="text-lg">Your reaction</h3>
      <p className="mt-1 text-sm text-muted">Recorded exactly as selected. The forecast above was saved first and is never edited.</p>

      <fieldset className="mt-3 border-0 p-0">
        <legend className="field-label">Reaction</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REACTIONS.map((r) => {
            const m = REACTION_META[r];
            const checked = reaction === r;
            return (
              <label
                key={r}
                className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border-2 p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal ${checked ? 'border-ink bg-paper-2 shadow-sm' : 'border-rule bg-card hover:border-rule-strong'}`}
              >
                <input type="radio" name="reaction" value={r} checked={checked} onChange={() => setReaction(r)} className="mt-1.5 h-4 w-4 accent-teal" />
                <span>
                  <span className="flex items-center gap-2 text-base font-semibold">
                    <ReactionMark reaction={r} size={18} />
                    <span aria-hidden="true">{m.glyph}</span>
                    {m.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{m.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4 border-0 p-0">
        <legend className="field-label">After this reaction (a separate choice)</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="continuation" checked={continuation === 'CONTINUE'} onChange={() => setContinuation('CONTINUE')} className="accent-teal" />
            Continue the session
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="continuation" checked={continuation === 'DISENGAGE'} onChange={() => setContinuation('DISENGAGE')} className="accent-teal" />
            Disengage <span className="text-xs text-muted">(ends this session)</span>
          </label>
        </div>
      </fieldset>

      <div className="mt-4">
        <div className="flex items-center justify-between border-t border-rule pt-3">
          <p className="field-label !mb-0">Requested changes (optional)</p>
          <button
            type="button"
            className="btn !min-h-8 !px-3 !py-1 text-sm"
            onClick={() => {
              setRows((rs) => [...rs, { id: nextId, dimensions: [], instruction: '' }]);
              setNextId((n) => n + 1);
            }}
          >
            + Add a change
          </button>
        </div>
        <RequestedChangeEffect policy={policy} />
        {rows.map((row, idx) => (
          <div key={row.id} className="mt-2 rounded border border-rule p-3">
            <div className="flex items-start justify-between gap-2">
              <fieldset className="border-0 p-0">
                <legend className="text-xs font-semibold">What should change? (optional dimensions)</legend>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {CHANGE_DIMENSIONS.map((d) => (
                    <label key={d} className="inline-flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={row.dimensions.includes(d)}
                        className="accent-teal"
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) => (x.id === row.id ? { ...x, dimensions: e.target.checked ? [...x.dimensions, d] : x.dimensions.filter((y) => y !== d) } : x)),
                          )
                        }
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="button" className="text-sm text-danger underline" onClick={() => setRows((rs) => rs.filter((x) => x.id !== row.id))}>
                Remove
              </button>
            </div>
            <label className="mt-2 block">
              <span className="field-label">Instruction {idx + 1}</span>
              <input
                className="field"
                type="text"
                value={row.instruction}
                maxLength={300}
                placeholder="e.g. Please make it quicker to prepare."
                onChange={(e) => setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, instruction: e.target.value } : x)))}
              />
            </label>
          </div>
        ))}
        {rowsInvalid && <p className="field-hint text-danger">Each requested change needs an instruction (or remove it).</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {busy ? 'Submitting…' : 'Submit reaction'}
        </button>
        {reaction === null && <span className="text-sm text-muted">Select a reaction to continue.</span>}
      </div>

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-5 shadow-xl">
            <AlertDialog.Title className="font-serif text-xl font-semibold">End this session?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm">
              Choosing “Disengage” records your reaction and then <strong>closes the session permanently</strong>. A closed session is a read-only record; you
              would start a new scenario to continue.
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel className="btn">Go back</AlertDialog.Cancel>
              <AlertDialog.Action
                className="btn btn-primary"
                onClick={() => {
                  setConfirmOpen(false);
                  submit();
                }}
              >
                Submit and end session
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </form>
  );
}
