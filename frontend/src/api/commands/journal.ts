import type { CommandName } from './keys';

/**
 * Write-ahead command journal.
 *
 * An entry (key + exact serialized body) is persisted BEFORE the request is
 * sent, so a lost response, a crash or a reload can always be recovered with
 * the same key and the identical body string. The backend hashes the submitted
 * payload, so the body is stored as the literal string that was sent.
 *
 * Response bodies are intentionally not stored (they can contain persona data).
 *
 * States:
 *   in_flight  request sent in this page load, no answer yet
 *   committed  backend answered 200
 *   rejected   backend answered with a JSON error (atomic: nothing committed)
 *   uncertain  no usable answer; may have committed; user may recover
 *   terminal   uncertain AND must never be retried (provider unknown completion)
 *   abandoned  user/system gave up on recovering
 */
export type JournalState = 'in_flight' | 'committed' | 'rejected' | 'uncertain' | 'terminal' | 'abandoned';

export interface JournalEntry {
  key: string;
  command: CommandName;
  path: string;
  body: string;
  sessionId?: string;
  expectedRevision?: number;
  assetFingerprint?: string;
  pageId: string;
  createdAt: string;
  settledAt?: string;
  state: JournalState;
  httpStatus?: number;
  errorCode?: string;
  note?: string;
}

const STORAGE_KEY = 'pcub.journal.v1';
const MAX_ENTRIES = 200;

/** Identifies this page load; in_flight entries from another load are really "uncertain". */
export const PAGE_ID: string = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Math.random());
  }
})();

type Listener = () => void;

export class CommandJournal {
  private entries: JournalEntry[] = [];
  private listeners = new Set<Listener>();
  private snapshot: readonly JournalEntry[] = [];
  private readonly storage: Storage | null;
  /** False when browser storage is unavailable: recovery after reload is then impossible. */
  readonly persistent: boolean;

  constructor(storage: Storage | null = safeLocalStorage()) {
    this.storage = storage;
    this.persistent = storage !== null;
    this.load();
    this.demoteStaleInFlight();
    this.snapshot = [...this.entries];
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) this.entries = parsed.filter(isEntry);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    this.snapshot = [...this.entries];
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries.slice(-MAX_ENTRIES)));
    } catch {
      /* storage full or blocked: the in-memory journal still works for this page load */
    }
    this.listeners.forEach((l) => l());
  }

  /** In-flight entries from a previous page load have an unknown outcome. */
  private demoteStaleInFlight(): void {
    let changed = false;
    for (const e of this.entries) {
      if (e.state === 'in_flight' && e.pageId !== PAGE_ID) {
        e.state = 'uncertain';
        e.note = 'Page was reloaded or closed while this request was in flight';
        e.settledAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Persist before sending. */
  begin(entry: Omit<JournalEntry, 'pageId' | 'createdAt' | 'state'>): JournalEntry {
    const e: JournalEntry = { ...entry, pageId: PAGE_ID, createdAt: new Date().toISOString(), state: 'in_flight' };
    this.entries.push(e);
    this.save();
    return e;
  }

  settle(key: string, patch: Partial<Pick<JournalEntry, 'state' | 'httpStatus' | 'errorCode' | 'note'>>): void {
    const e = this.entries.find((x) => x.key === key);
    if (!e) return;
    Object.assign(e, patch, { settledAt: new Date().toISOString() });
    this.save();
  }

  get(key: string): JournalEntry | undefined {
    return this.entries.find((x) => x.key === key);
  }

  /** Newest first. Stable reference between changes (for useSyncExternalStore). */
  list = (): readonly JournalEntry[] => this.snapshot;

  /** Entries whose outcome is unknown and may be recovered by the user. */
  recoverable(): JournalEntry[] {
    return this.entries.filter((e) => e.state === 'uncertain');
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Explicit user action only. */
  clear(): void {
    this.entries = [];
    this.save();
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

function isEntry(x: unknown): x is JournalEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.key === 'string' && typeof e.body === 'string' && typeof e.path === 'string' && typeof e.state === 'string';
}

function safeLocalStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__pcub_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const journal = new CommandJournal();
