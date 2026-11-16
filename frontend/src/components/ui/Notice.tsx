import type { ReactNode } from 'react';

type Tone = 'danger' | 'warn' | 'info' | 'ok';

const STYLE: Record<Tone, string> = {
  danger: 'border-danger bg-danger-soft',
  warn: 'border-warn bg-warn-soft',
  info: 'border-teal bg-teal-soft',
  ok: 'border-ok bg-ok-soft',
};
const TITLE: Record<Tone, string> = { danger: 'text-danger', warn: 'text-warn', info: 'text-teal', ok: 'text-ok' };

/** A non-error-object notice (instructions, caveats, empty/unavailable states). */
export function Notice({ tone = 'info', title, children, alert = false }: { tone?: Tone; title?: string; children?: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? 'alert' : 'note'} className={`rounded-lg border-2 p-4 ${STYLE[tone]}`}>
      {title && <p className={`font-semibold ${TITLE[tone]}`}>{title}</p>}
      {children && <div className={`text-sm ${title ? 'mt-1.5' : ''}`}>{children}</div>}
    </div>
  );
}
