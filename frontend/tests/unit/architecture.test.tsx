import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../msw/server';
import { createTestRouter } from '@/app/router';
import { createQueryClient } from '@/state/queryClient';
import { localIndex } from '@/state/localIndex';
import { EDGES, NODES, NODE_BY_ID, ROLE_NOTE, VIEWBOX } from '@/features/architecture/systemModel';
import { relations, labelAnchor } from '@/features/architecture/graph';
import { STEPS, PERSISTENCE } from '@/features/architecture/lifecycleModel';
import { STAGES } from '@/features/architecture/counterfactualModel';
import { MECHANISMS } from '@/features/architecture/evaluationModel';
import capabilities from '../fixtures/captured/capabilities.json';
import session2 from '../fixtures/captured/session_rev2_after_feedback.json';
import synJob from '../fixtures/captured/synthetic_structured_comparison_oracle.json';
import humanJob from '../fixtures/captured/comparison_human_pcub8.json';

const B = 'http://backend.test';
const j = (v: unknown) => HttpResponse.json(v as JsonBodyType);

function mount(path: string) {
  server.use(http.get(`${B}/v1/capabilities`, () => j(capabilities)));
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={createTestRouter([path])} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  for (const e of [...localIndex.list()]) localIndex.remove(e.kind, e.id);
});

/* ------------------------------------------------------------------ model */

describe('architecture model integrity', () => {
  it('includes every required component', () => {
    const titles = NODES.map((n) => n.title).join(' | ');
    for (const t of [
      'User Simulation Agent',
      'Conversational Recommendation Agent',
      'User Behavior Prediction Agent (UBPA)',
      'Longitudinal Memory Manager',
      'Counterfactual Evaluation Agent',
      'Session Orchestrator',
      'Hard-constraint filter',
      'Recommendation policies (4)',
      'Predictor modes (3)',
      'Simulator backends (2)',
      'Paired branch engine',
      'Allocators (4)',
      'synthetic oracle',
      'Frozen assets and models',
      'Recorded guarded decisions (77)',
      'Session & comparison store',
      'Provider journal',
      'Local HTTP API',
      'Frontend application',
      'Frozen R1 archive',
    ]) {
      expect(titles.toLowerCase()).toContain(t.toLowerCase());
    }
    expect(NODE_BY_ID.get('policies')!.members).toHaveLength(4);
    expect(NODE_BY_ID.get('predictors')!.members).toHaveLength(3);
    expect(NODE_BY_ID.get('simulators')!.members).toHaveLength(2);
    expect(NODE_BY_ID.get('allocators')!.members).toHaveLength(4);
  });

  it('every node has complete inspector content', () => {
    for (const n of NODES) {
      expect(n.summary.length, n.id).toBeGreaterThan(20);
      expect(n.implementation.length, n.id).toBeGreaterThan(10);
      for (const k of ['inputs', 'outputs', 'reads', 'writes', 'limits'] as const) expect(n[k].length, `${n.id}.${k}`).toBeGreaterThan(0);
      expect(n.persistence.length, n.id).toBeGreaterThan(2);
      expect(n.evidence.length, n.id).toBeGreaterThan(0);
    }
  });

  it('exactly five functional agent roles; only the policies node carries the optional LLM', () => {
    expect(NODES.filter((n) => n.kind === 'role').map((n) => n.id).sort()).toEqual(['cfe', 'memory', 'rec', 'ubpa', 'usersim'].sort());
    expect(NODES.filter((n) => n.llm).map((n) => n.id)).toEqual(['policies']);
    expect(ROLE_NOTE).toMatch(/not an autonomous language-model process/);
  });

  it('every edge connects existing nodes and starts/ends on its nodes’ borders', () => {
    const onBorder = (p: [number, number], id: string) => {
      const n = NODE_BY_ID.get(id)!;
      const [x, y] = p;
      const inX = x >= n.x - 0.5 && x <= n.x + n.w + 0.5;
      const inY = y >= n.y - 0.5 && y <= n.y + n.h + 0.5;
      const onV = (Math.abs(x - n.x) < 0.5 || Math.abs(x - (n.x + n.w)) < 0.5) && inY;
      const onH = (Math.abs(y - n.y) < 0.5 || Math.abs(y - (n.y + n.h)) < 0.5) && inX;
      return onV || onH;
    };
    for (const e of EDGES) {
      expect(NODE_BY_ID.has(e.from), e.id).toBe(true);
      expect(NODE_BY_ID.has(e.to), e.id).toBe(true);
      expect(onBorder(e.points[0]!, e.from), `${e.id} start`).toBe(true);
      expect(onBorder(e.points[e.points.length - 1]!, e.to), `${e.id} end`).toBe(true);
    }
  });

  it('connectors are orthogonal and never pass through any other node', () => {
    for (const e of EDGES) {
      for (let i = 1; i < e.points.length; i++) {
        const [x1, y1] = e.points[i - 1]!;
        const [x2, y2] = e.points[i]!;
        expect(x1 === x2 || y1 === y2, `${e.id} segment ${i} must be orthogonal`).toBe(true);
        for (const n of NODES) {
          if (n.id === e.from || n.id === e.to) continue;
          // Strict interior intersection test for an axis-aligned segment.
          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          const hits = maxX > n.x && minX < n.x + n.w && maxY > n.y && minY < n.y + n.h;
          expect(hits, `${e.id} segment ${i} crosses ${n.id}`).toBe(false);
        }
      }
    }
  });

  it('nodes stay inside the viewBox and never overlap', () => {
    for (const a of NODES) {
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= VIEWBOX.w && a.y + a.h <= VIEWBOX.h, a.id).toBe(true);
      for (const b of NODES) {
        if (a.id >= b.id) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('labels: fixed anchors, rotated gutter labels, and suppressed labels resolve as declared', () => {
    expect(labelAnchor(EDGES.find((e) => e.id === 'f-sim-trans')!)).toBeNull();
    expect(labelAnchor(EDGES.find((e) => e.id === 'f-trans-store')!)?.rotate).toBe(true);
    expect(labelAnchor(EDGES.find((e) => e.id === 's-fe-api')!)).toEqual({ x: 480, y: 92, rotate: false });
  });

  it('relations: direct neighbours by default, full chain on request', () => {
    const r = relations(EDGES, 'transition', false);
    expect([...r.upstream].sort()).toEqual(['human', 'memory', 'simulators'].sort());
    expect([...r.downstream].sort()).toEqual(['predictors', 'store'].sort());
    const full = relations(EDGES, 'transition', true);
    expect(full.upstream.has('orchestrator')).toBe(true);
    expect(full.upstream.has('api')).toBe(true);
    expect(full.downstream.has('assets')).toBe(true);
    expect(relations(EDGES, null, true).edges.size).toBe(0);
  });

  it('never mentions LLM-as-a-judge or speculative future modules anywhere in the explorer content', () => {
    const all = JSON.stringify({ NODES, EDGES, STEPS, PERSISTENCE, STAGES, MECHANISMS });
    expect(all).not.toMatch(/judge/i);
    expect(all).not.toMatch(/roadmap|future work|future evaluation/i);
  });

  it('scientific boundaries are stated in the content', () => {
    const all = JSON.stringify({ NODES, STEPS, STAGES, MECHANISMS });
    expect(all).toMatch(/never human ground truth/i);
    expect(all).toMatch(/frozen population predictor/i);
    expect(all).toMatch(/never prune branches/i);
    expect(all).toMatch(/not validated psychological measurements/i);
    expect(all).toMatch(/no learned identity transfers between scenarios/i);
    expect(all).toMatch(/strict PCUB superiority/i);
    expect(STEPS.find((s) => s.id === 'commit-forecast')!.writes).toMatch(/History is NOT extended/);
  });
});

/* ---------------------------------------------------------- system map UI */

describe('Architecture explorer — System map', () => {
  it('has four tabs; System map is the default', async () => {
    mount('/architecture');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('System map'),
      expect.stringContaining('Longitudinal lifecycle'),
      expect.stringContaining('Counterfactual evaluation'),
      expect.stringContaining('Evaluation map'),
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Select a component')).toBeInTheDocument();
  });

  it('clicking a node opens the inspector and highlights upstream / downstream; others are dimmed', async () => {
    mount('/architecture');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Session Orchestrator (Orchestration)' }));
    const inspector = screen.getByRole('complementary', { name: 'Component inspector' });
    expect(within(inspector).getByRole('heading', { name: 'Session Orchestrator' })).toBeInTheDocument();
    for (const s of ['Implementation', 'Inputs', 'Outputs', 'Can read', 'Can modify', 'Connections', 'Persistence', 'Provenance / evidence type', 'Limitations and non-claims']) {
      expect(within(inspector).getByRole('heading', { name: s })).toBeInTheDocument();
    }
    const svg = screen.getByRole('group', { name: /System map/ });
    expect(svg.querySelector('[data-node="orchestrator"]')).toHaveAttribute('data-state', 'selected');
    expect(svg.querySelector('[data-node="api"]')).toHaveAttribute('data-state', 'up');
    expect(svg.querySelector('[data-node="rec"]')).toHaveAttribute('data-state', 'down');
    expect(svg.querySelector('[data-node="store"]')).toHaveAttribute('data-state', 'down');
    expect(svg.querySelector('[data-node="r1"]')).toHaveAttribute('data-state', 'dim');
  });

  it('is keyboard operable: Enter selects a focused node, Escape clears', async () => {
    mount('/architecture');
    const node = await screen.findByRole('button', { name: 'Exhaustive synthetic oracle (Implementation module)' });
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    const inspector = screen.getByRole('complementary', { name: 'Component inspector' });
    expect(within(inspector).getByText(/never human ground truth/i)).toBeInTheDocument();
    fireEvent.keyDown(node, { key: 'Escape' });
    expect(screen.getByText('Select a component')).toBeInTheDocument();
  });

  it('agent roles carry the functional-role note; the policies node flags the only optional LLM', async () => {
    mount('/architecture?view=system&node=ubpa');
    expect(await screen.findByTestId('role-note')).toHaveTextContent(/not an autonomous language-model process/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Recommendation policies (4) (Implementation module)' }));
    expect(screen.getByText(/Contains the only optional language-model component/)).toBeInTheDocument();
    expect(screen.queryByTestId('role-note')).not.toBeInTheDocument();
  });

  it('inspector connections navigate to related components; Reset clears the selection', async () => {
    mount('/architecture?view=system&node=transition');
    const inspector = await screen.findByRole('complementary', { name: 'Component inspector' });
    const user = userEvent.setup();
    await user.click(within(inspector).getByRole('button', { name: 'Session & comparison store (SQLite)' }));
    expect(within(inspector).getByRole('heading', { name: 'Session & comparison store (SQLite)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset selection' }));
    expect(screen.getByText('Select a component')).toBeInTheDocument();
  });

  it('“Show all data flows” draws every flow edge; by default only structure plus the selection’s flows', async () => {
    mount('/architecture');
    const svg = (await screen.findByRole('group', { name: /System map/ })) as unknown as SVGElement;
    const structure = EDGES.filter((e) => e.tier === 'structure').length;
    expect(svg.querySelectorAll('[data-edge]')).toHaveLength(structure);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Show all data flows' }));
    expect(svg.querySelectorAll('[data-edge]')).toHaveLength(EDGES.length);
  });

  it('tabs support arrow-key navigation', async () => {
    mount('/architecture');
    const tabs = await screen.findAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(await screen.findByRole('button', { name: 'Next step →' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
  });
});

/* ------------------------------------------------------------ lifecycle UI */

describe('Architecture explorer — Longitudinal lifecycle', () => {
  it('steps through the lifecycle with buttons, stations and arrow keys', async () => {
    mount('/architecture?view=lifecycle');
    expect(await screen.findByRole('heading', { name: 'Candidate window' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next step →' }));
    expect(screen.getByRole('heading', { name: 'Hard-constraint filtering' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Step 5: Forecast committed before reveal/ }));
    expect(screen.getByText(/History is NOT extended here/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Forecast committed before reveal' }), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Outcome: human-submitted OR simulator-generated' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Step 10: segment rollover' }));
    expect(screen.getByText(/third completed turn is segment 2, turn 1/)).toBeInTheDocument();
    expect(screen.getByText(/no learned identity or memory transferred between separate/i)).toBeInTheDocument();
  });

  it('grounds the walkthrough in a real session’s RETURNED values, highlighting the row for the current step', async () => {
    const s = session2 as { id: string; persona: { display_name: string } };
    localIndex.upsert({ kind: 'session', id: s.id, world_kind: 'human_interaction', policy: 'deterministic_recipe_recommendation', predictor: 'contextual', label: 'Captured human', createdAt: '2026-11-10' });
    server.use(http.get(`${B}/v1/sessions/:id`, () => j(session2)));
    mount('/architecture?view=lifecycle');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Session'), s.id);
    expect(await screen.findByText('Forecast (made before reveal)')).toBeInTheDocument();
    expect(screen.getByText('Simple Apple Bacon Saute')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Step 6: Outcome/ }));
    const outcomeRow = document.querySelector('[data-ground="Outcome"]')!;
    expect(outcomeRow).toHaveAttribute('data-on', 'true');
    expect(within(outcomeRow as HTMLElement).getAllByText(/Modify \/ clarify/).length).toBeGreaterThan(0);
    expect(outcomeRow).toHaveTextContent('origin: human_submission');
  });
});

/* ------------------------------------------------------- counterfactual UI */

describe('Architecture explorer — Counterfactual evaluation', () => {
  it('human world: synthetic-only stages explain that no human oracle exists', async () => {
    mount('/architecture?view=counterfactual');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /Human session/ }));
    await user.click(screen.getByRole('button', { name: /Exhaustive synthetic oracle/ }));
    expect(screen.getByText(/no human oracle exists/i)).toBeInTheDocument();
  });

  it('schematic: no node is marked as expanded (the explorer does not guess allocator choices)', async () => {
    mount('/architecture?view=counterfactual');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Budget-limited expansion/ }));
    expect(document.querySelectorAll('[data-forest-node][data-state="expanded"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-forest-node]')).toHaveLength(20);
  });

  it('overlaying a real synthetic comparison marks exactly the backend’s expanded nodes and shows its oracle and metrics verbatim', async () => {
    const job = synJob as unknown as { id: string; session_id: string; factual_revision: number; result: { nodes: unknown[] }; metrics: { regret: number } };
    localIndex.upsert({ kind: 'job', id: job.id, sessionId: job.session_id, factualRevision: job.factual_revision, label: 'Captured synthetic job', createdAt: '2026-11-10' });
    server.use(http.get(`${B}/v1/branch-comparisons/:id`, () => j(synJob)));
    mount('/architecture?view=counterfactual');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Comparison'), job.id);
    await screen.findByText(/open full result/);
    await user.click(screen.getByRole('button', { name: /Budget-limited expansion/ }));
    expect(document.querySelectorAll('[data-forest-node][data-state="expanded"]')).toHaveLength(job.result.nodes.length);
    await user.click(screen.getByRole('button', { name: /Regret and returned metrics/ }));
    expect(screen.getByRole('region', { name: 'Synthetic oracle' })).toHaveTextContent(/never human ground truth/);
    expect(within(screen.getByRole('region', { name: 'Evaluation metrics' })).getByText('regret')).toBeInTheDocument();
  });

  it('overlaying a real human comparison keeps the oracle absent', async () => {
    const job = humanJob as unknown as { id: string; session_id: string; factual_revision: number };
    localIndex.upsert({ kind: 'job', id: job.id, sessionId: job.session_id, factualRevision: job.factual_revision, label: 'Captured human job', createdAt: '2026-11-10' });
    server.use(http.get(`${B}/v1/branch-comparisons/:id`, () => j(humanJob)));
    mount('/architecture?view=counterfactual');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Comparison'), job.id);
    await screen.findByText(/open full result/);
    await user.click(screen.getByRole('button', { name: /Exhaustive synthetic oracle/ }));
    expect(screen.getByRole('region', { name: 'Synthetic oracle' })).toHaveTextContent(/No oracle result/);
  });
});

/* ------------------------------------------------------------ evaluation UI */

describe('Architecture explorer — Evaluation map', () => {
  it('lists only the implemented mechanisms and keeps R1 in its own column', async () => {
    mount('/architecture?view=evaluation');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(1 + MECHANISMS.length);
    expect(within(table).getByRole('columnheader', { name: 'Frozen historical R1' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(table).getByRole('button', { name: /Synthetic oracle comparison/ }));
    expect(screen.getByRole('heading', { name: 'Synthetic oracle comparison' })).toBeInTheDocument();
    expect(screen.getByText(/No human oracle exists/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/judge/i);
  });
});

describe('Overview wording', () => {
  it('names the system as the testbed and PCUB as its allocation method', async () => {
    mount('/');
    expect(await screen.findByText(/This\s+longitudinal recommendation research testbed makes these dependencies visible/)).toBeInTheDocument();
    expect(screen.getByText(/Its PCUB method allocates a limited budget/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PCUB is a research testbed/);
  });
});
