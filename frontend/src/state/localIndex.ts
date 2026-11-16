import type { WorldKind } from '@/api/schemas';

/**
 * The backend has no endpoint to list sessions or jobs (limitation U3), so this
 * browser remembers the ids it has created or opened. It stores identifiers and
 * labels only: no persona content, no responses.
 */
export interface SessionIndexEntry {
  kind: 'session';
  id: string;
  world_kind: WorldKind;
  policy: string;
  predictor: string;
  label: string;
  createdAt: string;
  assetFingerprint?: string;
  /** Replaced by a "start fresh" scenario; still openable. */
  supersededBy?: string;
  /** Last GET returned NOT_FOUND (different backend database). */
  missing?: boolean;
}

export interface JobIndexEntry {
  kind: 'job';
  id: string;
  sessionId: string;
  factualRevision: number;
  label: string;
  createdAt: string;
  missing?: boolean;
}

export type IndexEntry = SessionIndexEntry | JobIndexEntry;

const STORAGE_KEY = 'pcub.index.v1';
type Listener = () => void;

export class LocalIndex {
  private entries: IndexEntry[] = [];
  private snapshot: readonly IndexEntry[] = [];
  private listeners = new Set<Listener>();
  private readonly storage: Storage | null;
  readonly persistent: boolean;

  constructor(storage: Storage | null = safeStorage()) {
    this.storage = storage;
    this.persistent = storage !== null;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed.filter((e): e is IndexEntry => !!e && typeof e === 'object' && 'id' in e && 'kind' in e);
      }
    } catch {
      this.entries = [];
    }
    this.snapshot = [...this.entries];
  }

  private commit(): void {
    this.snapshot = [...this.entries];
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      /* in-memory only */
    }
    this.listeners.forEach((l) => l());
  }

  list = (): readonly IndexEntry[] => this.snapshot;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  upsert(entry: IndexEntry): void {
    const i = this.entries.findIndex((e) => e.kind === entry.kind && e.id === entry.id);
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...entry } as IndexEntry;
    else this.entries.push(entry);
    this.commit();
  }

  markMissing(kind: IndexEntry['kind'], id: string, missing: boolean): void {
    const e = this.entries.find((x) => x.kind === kind && x.id === id);
    if (e && e.missing !== missing) {
      e.missing = missing;
      this.commit();
    }
  }

  markSuperseded(id: string, by: string): void {
    const e = this.entries.find((x): x is SessionIndexEntry => x.kind === 'session' && x.id === id);
    if (e) {
      e.supersededBy = by;
      this.commit();
    }
  }

  /** Explicit user action only. */
  remove(kind: IndexEntry['kind'], id: string): void {
    this.entries = this.entries.filter((e) => !(e.kind === kind && e.id === id));
    this.commit();
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }
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

export const localIndex = new LocalIndex();
