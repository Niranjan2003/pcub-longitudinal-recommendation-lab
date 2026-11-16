import type { ReactNode } from 'react';
import { ApiError, CLIENT_BUG_CODES, ERROR_EXPLANATIONS } from '@/api/errors';
import { RawJson } from './RawJson';

/**
 * Errors are real states. The backend code and optional `action` text are
 * always shown verbatim; the plain-language line only explains the meaning.
 * Nothing here retries, substitutes data, or hides the failure.
 */
export function ErrorPanel({ error, title, children }: { error: unknown; title?: string; children?: ReactNode }) {
  if (!(error instanceof ApiError)) {
    return (
      <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft p-4">
        <p className="font-semibold text-danger">{title ?? 'Unexpected error'}</p>
        <p className="mt-1 text-sm">{error instanceof Error ? error.message : String(error)}</p>
        {children}
      </div>
    );
  }
  const clientBug = error.code !== undefined && CLIENT_BUG_CODES.has(error.code);
  const heading =
    title ??
    (error.kind === 'contract'
      ? 'Contract mismatch'
      : error.kind === 'network'
        ? 'Backend not reachable'
        : error.kind === 'uncertain'
          ? 'No confirmed answer'
          : clientBug
            ? 'Frontend contract error'
            : 'The backend declined this request');
  const explanation =
    error.kind === 'contract'
      ? 'The response was received, but it does not match the documented contract, so nothing was rendered from it. This is shown instead of partial or invented values.'
      : error.kind === 'uncertain'
        ? 'The request may or may not have been committed. Do not repeat the action; use Recover below (it replays the identical request safely).'
        : error.kind === 'network'
          ? 'Check that the offline backend is running on 127.0.0.1:8765.'
          : error.code
            ? (ERROR_EXPLANATIONS[error.code] ?? '')
            : '';

  return (
    <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft p-4">
      <p className="font-semibold text-danger">
        {heading}
        {error.code && (
          <>
            {' '}
            <code className="ml-1 rounded bg-white/70 px-1.5 py-0.5 text-sm">{error.code}</code>
          </>
        )}
        {error.status !== undefined && <span className="ml-2 text-sm font-normal text-muted">HTTP {error.status}</span>}
      </p>
      {explanation && <p className="mt-1.5 text-sm">{explanation}</p>}
      {error.action && (
        <p className="mt-1.5 text-sm">
          <span className="font-semibold">Backend note: </span>
          {error.action}
        </p>
      )}
      {clientBug && <p className="mt-1.5 text-sm">This indicates a bug in the frontend, not a problem with your input.</p>}
      {error.issues && error.issues.length > 0 && (
        <ul className="mono mt-2 list-disc pl-5 text-xs">
          {error.issues.slice(0, 8).map((i, n) => (
            <li key={n}>
              {i.path.join('.') || '(root)'}: {i.message}
            </li>
          ))}
        </ul>
      )}
      {children && <div className="mt-3">{children}</div>}
      {error.raw !== undefined && (
        <div className="mt-2">
          <RawJson data={error.raw} label="Raw response" />
        </div>
      )}
    </div>
  );
}
