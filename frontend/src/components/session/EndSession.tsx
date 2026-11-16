import { useState } from 'react';
import { AlertDialog } from 'radix-ui';

/**
 * Cancel (pending) / close. Both are terminal in this service and record no
 * reaction. The wording says so before the user commits.
 */
export function EndSessionButton({ hasPending, busy, onConfirm }: { hasPending: boolean; busy: boolean; onConfirm: (op: 'cancel' | 'close') => void }) {
  const [open, setOpen] = useState(false);
  const op = hasPending ? 'cancel' : 'close';
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger className="btn btn-danger" disabled={busy}>
        {hasPending ? 'Cancel and end session…' : 'End session…'}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-5 shadow-xl">
          <AlertDialog.Title className="font-serif text-xl font-semibold">{hasPending ? 'Cancel this recommendation and end the session?' : 'End this session permanently?'}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm">
            {hasPending ? (
              <>
                The pending recommendation is recorded as <strong>cancelled</strong>. No reaction is revealed and no state change is applied.
              </>
            ) : (
              <>No further turns will be possible.</>
            )}{' '}
            This is <strong>permanent</strong>: a closed session stays readable as a record, but cannot be reopened.
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className="btn">Keep session open</AlertDialog.Cancel>
            <AlertDialog.Action
              className="btn btn-danger"
              onClick={() => {
                setOpen(false);
                onConfirm(op);
              }}
            >
              {hasPending ? 'Cancel and end session' : 'End session'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
