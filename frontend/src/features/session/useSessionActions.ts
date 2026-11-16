import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { advanceSynthetic, endSession, recommend, submitHumanFeedback } from '@/api/endpoints';
import type { CommandResult } from '@/api/commands/runCommand';
import type { Session } from '@/api/schemas';
import { useSessionCacheWriter } from '@/state/hooks';
import { stateLog } from '@/state/stateLog';
import type { FeedbackSubmit } from '@/components/session/FeedbackDock';

/**
 * Commands for one session. Every mutation: new idempotency key, journaled
 * before send, retry 0. The session object passed in supplies expected_revision
 * (the latest fetched revision, never incremented locally).
 */
/**
 * Live-provider gate. On a live-capable backend a guarded-LLM recommendation can
 * make one provider request, so it needs the user's explicit consent for the
 * session, and multi-turn runs are refused (one click per possible request).
 */
export interface LiveGate {
  liveGuarded: boolean;
  liveAllowed: boolean;
}

export function useSessionActions(
  session: Session | undefined,
  assetFingerprint: string | undefined,
  onDone: (message: string, s: Session) => void,
  live: LiveGate = { liveGuarded: false, liveAllowed: false },
) {
  const writeSession = useSessionCacheWriter();
  const requireLiveConsent = () => {
    if (live.liveGuarded && !live.liveAllowed) {
      throw new Error('Not sent: live provider requests are not allowed for this session. Allow them in the live panel first.');
    }
  };
  const ctx = { assetFingerprint };
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const finish = (message: string) => (r: CommandResult<Session>) => {
    writeSession(r.value);
    stateLog.record(r.value);
    onDone(message, r.value);
  };

  const getRecommendation = useMutation({
    mutationFn: () => {
      requireLiveConsent();
      return recommend(session!, ctx);
    },
    retry: 0,
    onSuccess: finish('Recommendation ready. A forecast was recorded before any reaction.'),
  });

  const feedback = useMutation({
    mutationFn: (f: FeedbackSubmit) =>
      submitHumanFeedback(
        session!,
        { recommendationId: session!.pending!.id, reaction: f.reaction, continuation: f.continuation, requestedChanges: f.requestedChanges },
        ctx,
      ),
    retry: 0,
    onSuccess: finish('Reaction recorded. The session state and history were updated.'),
  });

  /** Synthetic: the simulator owns the reaction. No reaction field can be sent. */
  const advance = useMutation({
    mutationFn: () => advanceSynthetic(session!, session!.pending!.id, ctx),
    retry: 0,
    onSuccess: finish('The simulator generated a reaction. The session state and history were updated.'),
  });

  /**
   * Synthetic convenience: run N turns (recommend, then simulator reaction),
   * sequentially. Each step is its own journaled command with its own key. The
   * loop stops at the first error or when the session closes, and never retries.
   */
  const runTurns = useMutation({
    mutationFn: async (n: number) => {
      requireLiveConsent();
      if (live.liveGuarded && n > 1) {
        throw new Error('Not sent: with live guarded scoring, turns run one at a time so that each provider request follows its own click.');
      }
      let s = session!;
      setProgress({ done: 0, total: n });
      for (let i = 0; i < n && s.status === 'open'; i++) {
        if (!s.pending) {
          s = (await recommend(s, ctx)).value;
          writeSession(s);
        }
        s = (await advanceSynthetic(s, s.pending!.id, ctx)).value;
        writeSession(s);
        stateLog.record(s);
        setProgress({ done: i + 1, total: n });
      }
      return s;
    },
    retry: 0,
    onSuccess: (s) =>
      onDone(
        `Ran turns with simulator-generated reactions. ${s.history.length} turns are now complete.${s.status === 'closed' ? ' The planned horizon is complete and the session is closed.' : ''}`,
        s,
      ),
    onSettled: () => setProgress(null),
  });

  const end = useMutation({
    mutationFn: (op: 'cancel' | 'close') => endSession(session!, op, ctx),
    retry: 0,
    onSuccess: finish('Session ended. It is now a read-only record.'),
  });

  const busy = getRecommendation.isPending || feedback.isPending || advance.isPending || runTurns.isPending || end.isPending;
  const error = getRecommendation.error ?? feedback.error ?? advance.error ?? runTurns.error ?? end.error;
  const reset = () => {
    getRecommendation.reset();
    feedback.reset();
    advance.reset();
    runTurns.reset();
    end.reset();
  };

  return { getRecommendation, feedback, advance, runTurns, end, busy, error, reset, progress };
}
