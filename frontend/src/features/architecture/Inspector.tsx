import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EDGES, KIND_LABEL, NODE_BY_ID, ROLE_NOTE, type ArchNode } from './systemModel';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-rule pt-3">
      <h4 className="mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h4>
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="m-0 list-disc space-y-0.5 pl-5">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** Detail inspector for one System Map node. Static documentation content only. */
export function NodeInspector({ node, onSelect }: { node: ArchNode; onSelect: (id: string) => void }) {
  const incoming = EDGES.filter((e) => e.to === node.id);
  const outgoing = EDGES.filter((e) => e.from === node.id);

  return (
    <article aria-labelledby="inspector-title" className="space-y-3">
      <header>
        <p className="mono text-[11px] uppercase tracking-[0.14em] text-muted">{KIND_LABEL[node.kind]}</p>
        <h3 id="inspector-title" className="mt-0.5 text-2xl">
          {node.title}
        </h3>
        <p className="mt-2">{node.summary}</p>
      </header>

      {node.kind === 'role' && (
        <p className="border-l-4 border-teal bg-teal-soft px-3 py-2 text-sm" data-testid="role-note">
          {ROLE_NOTE}
        </p>
      )}
      {node.llm && (
        <p className="border-l-4 border-warn bg-warn-soft px-3 py-2 text-sm">
          ◇ Contains the only optional language-model component (the guarded scorer). Offline, it can answer only requests that exactly match a recorded
          context; it never decides outcomes.
        </p>
      )}

      <Section title="Implementation">{node.implementation}</Section>

      {node.members && (
        <Section title="Members">
          <dl className="m-0 space-y-2">
            {node.members.map((m) => (
              <div key={m.name}>
                <dt className="font-semibold">
                  {m.name} {m.id && <span className="mono text-xs font-normal text-muted">{m.id}</span>}
                </dt>
                <dd className="m-0 text-muted">{m.text}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <div className="grid gap-x-6 sm:grid-cols-2">
        <Section title="Inputs">
          <Bullets items={node.inputs} />
        </Section>
        <Section title="Outputs">
          <Bullets items={node.outputs} />
        </Section>
        <Section title="Can read">
          <Bullets items={node.reads} />
        </Section>
        <Section title="Can modify">
          <Bullets items={node.writes} />
        </Section>
      </div>

      <Section title="Connections">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Upstream — acts on or sends to this</p>
            {incoming.length === 0 ? (
              <p className="text-muted">—</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {incoming.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="text-left text-teal underline underline-offset-2" onClick={() => onSelect(e.from)}>
                      {NODE_BY_ID.get(e.from)?.title}
                    </button>
                    <span className="text-muted"> — {e.label}</span>
                    {e.optional && <span className="text-xs text-warn"> (optional mode)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs text-muted">Downstream — this acts on or sends to</p>
            {outgoing.length === 0 ? (
              <p className="text-muted">—</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {outgoing.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="text-left text-teal underline underline-offset-2" onClick={() => onSelect(e.to)}>
                      {NODE_BY_ID.get(e.to)?.title}
                    </button>
                    <span className="text-muted"> — {e.label}</span>
                    {e.optional && <span className="text-xs text-warn"> (optional mode)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title="Persistence">{node.persistence}</Section>
      <Section title="Provenance / evidence type">{node.evidence}</Section>
      <Section title="Limitations and non-claims">
        <Bullets items={node.limits} />
      </Section>

      {node.links && node.links.length > 0 && (
        <Section title="See it in the application">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {node.links.map((l) => (
              <li key={l.to + l.label}>
                <Link to={l.to} className="btn !min-h-8 !px-3 !py-1 text-sm no-underline">
                  {l.label} →
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}
