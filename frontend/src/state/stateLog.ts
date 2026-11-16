import type { DynamicState, Session } from '@/api/schemas';

/**
 * The API returns only the CURRENT engineered state; it exposes no per-turn
 * state series. To show longitudinal change, this browser records the state
 * values it OBSERVES in backend responses, keyed by completed-turn count.
 * Values are stored exactly as returned (never computed). Points the browser
 * never saw are simply absent, and the UI says so.
 */
export interface StateObservation {
  /** Number of completed turns (history length) when observed. */
  completed: number;
  revision: number;
  state: DynamicState;
  observedAt: string;
}

const STORAGE_KEY = 'pcub.statelog.v1';
type Listener = () => void;

export class StateLog {
  private data: Record<string, StateObservation[]> = {};
  private snapshots = new Map<string, readonly StateObservation[]>();
  private listeners = new Set<Listener>();
  private readonly storage: Storage | null;

  constructor(storage: Storage | null = safeStorage()) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.data = parsed as Record<string, StateObservation[]>;
      }
    } catch {
      this.data = {};
    }
  }

  private commit(id: string): void {
    this.snapshots.set(id, [...(this.data[id] ?? [])]);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* in memory only */
    }
    this.listeners.forEach((l) => l());
  }

  /** Record what the backend just returned. Latest observation wins per completed-turn count. */
  record(s: Session): void {
    const list = (this.data[s.id] ??= []);
    const completed = s.history.length;
    const existing = list.findIndex((o) => o.completed === completed);
    const obs: StateObservation = { completed, revision: s.revision, state: s.state, observedAt: new Date().toISOString() };
    if (existing >= 0) {
      const prev = list[existing]!;
      if (prev.revision > obs.revision || JSON.stringify(prev.state) === JSON.stringify(obs.state)) return;
      list[existing] = obs;
    } else {
      list.push(obs);
      list.sort((a, b) => a.completed - b.completed);
    }
    this.commit(s.id);
  }

  get = (id: string): readonly StateObservation[] => {
    let snap = this.snapshots.get(id);
    if (!snap) {
      snap = [...(this.data[id] ?? [])];
      this.snapshots.set(id, snap);
    }
    return snap;
  };

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__pcub_probe__', '1');
    s.removeItem('__pcub_probe__');
    return s;
  } catch {
    return null;
  }
}

export const stateLog = new StateLog();
