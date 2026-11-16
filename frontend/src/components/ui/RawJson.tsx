import { useState } from 'react';

/**
 * Collapsible raw wire data: the faithful view behind every rendered object.
 * The JSON is serialized only while open, so very large payloads (e.g. the R1
 * tables) cost nothing until a reader asks for them.
 */
export function RawJson({ data, label = 'Raw JSON' }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-sm" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none text-muted hover:text-ink">{label}</summary>
      {open && (
        <pre className="mono mt-2 max-h-96 overflow-auto rounded border border-rule bg-paper-2 p-3 text-xs leading-snug">{JSON.stringify(data, null, 2)}</pre>
      )}
    </details>
  );
}
