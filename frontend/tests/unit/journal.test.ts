import { describe, expect, it } from 'vitest';
import { CommandJournal, PAGE_ID } from '@/api/commands/journal';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const entry = {
  key: 'pcubfe-v1:recommend:k1',
  command: 'recommend' as const,
  path: '/v1/sessions/s/recommendations',
  body: '{"expected_revision":0}',
  sessionId: 's',
  expectedRevision: 0,
};

describe('CommandJournal', () => {
  it('persists an entry as in_flight BEFORE any request (write-ahead)', () => {
    const storage = new MemoryStorage();
    const j = new CommandJournal(storage);
    j.begin(entry);
    const stored = JSON.parse(storage.getItem('pcub.journal.v1') ?? '[]') as { key: string; state: string; body: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ key: entry.key, state: 'in_flight', body: entry.body });
  });

  it('stores the exact body string, byte for byte', () => {
    const j = new CommandJournal(new MemoryStorage());
    const body = '{"b":1,"a":[ 2 ,3]}';
    j.begin({ ...entry, body });
    expect(j.get(entry.key)?.body).toBe(body);
  });

  it('an in_flight entry left by a previous page load becomes uncertain (recoverable), never silently lost', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'pcub.journal.v1',
      JSON.stringify([{ ...entry, pageId: 'some-older-page', createdAt: new Date().toISOString(), state: 'in_flight' }]),
    );
    expect(PAGE_ID).not.toBe('some-older-page');
    const j = new CommandJournal(storage);
    expect(j.get(entry.key)?.state).toBe('uncertain');
    expect(j.recoverable()).toHaveLength(1);
  });

  it('settle updates state; response bodies are never stored', () => {
    const storage = new MemoryStorage();
    const j = new CommandJournal(storage);
    j.begin(entry);
    j.settle(entry.key, { state: 'committed', httpStatus: 200 });
    expect(j.get(entry.key)).toMatchObject({ state: 'committed', httpStatus: 200 });
    expect(storage.getItem('pcub.journal.v1')).not.toContain('persona');
  });

  it('works in memory (and reports non-persistent) when browser storage is unavailable', () => {
    const j = new CommandJournal(null);
    expect(j.persistent).toBe(false);
    j.begin(entry);
    expect(j.list()).toHaveLength(1);
  });

  it('survives corrupt stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem('pcub.journal.v1', '{not json');
    expect(new CommandJournal(storage).list()).toEqual([]);
  });

  it('notifies subscribers and exposes a stable snapshot between changes', () => {
    const j = new CommandJournal(new MemoryStorage());
    let calls = 0;
    j.subscribe(() => calls++);
    const a = j.list();
    expect(j.list()).toBe(a);
    j.begin(entry);
    expect(calls).toBe(1);
    expect(j.list()).not.toBe(a);
  });
});
