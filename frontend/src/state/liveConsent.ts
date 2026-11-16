import { useSyncExternalStore } from 'react';
import { PAGE_ID, journal, type JournalEntry } from '@/api/commands/journal';

/**
 * Explicit operator consent for live provider requests, per session.
 *
 * On a live-capable backend a guarded-LLM recommendation can send one request
 * to the real provider. The interface sends no such command until the user has
 * deliberately allowed it for that session. Consent lives in memory only: a
 * reload, a new tab or another session asks again. No credential is involved;
 * the provider endpoint and token stay in the backend process.
 */
type Listener = () => void;

const granted = new Map<string, string>();
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export const liveConsent = {
  grant(sessionId: string) {
    granted.set(sessionId, new Date().toISOString());
    emit();
  },
  revoke(sessionId: string) {
    if (granted.delete(sessionId)) emit();
  },
  has(sessionId: string): boolean {
    return granted.has(sessionId);
  },
  grantedAt(sessionId: string): string | undefined {
    return granted.get(sessionId);
  },
  /** Test helper and page-wide stop: forget every consent. */
  revokeAll() {
    if (granted.size > 0) {
      granted.clear();
      emit();
    }
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useLiveConsent(sessionId: string): boolean {
  useSyncExternalStore(liveConsent.subscribe, () => version, () => version);
  return liveConsent.has(sessionId);
}

/**
 * Live provider work stops for this page load after a provider unknown
 * completion (the backend's instruction: stop live operations, preserve the
 * journal, never retry). Derived from the command journal, so it cannot be
 * cleared by accident; a deliberate reload is required to continue.
 */
export function unknownCompletionThisPage(entries: readonly JournalEntry[] = journal.list()): boolean {
  return entries.some((e) => e.state === 'terminal' && e.pageId === PAGE_ID);
}

/** Earlier page loads (or other tabs) recorded an unknown completion in this browser. */
export function unknownCompletionEarlier(entries: readonly JournalEntry[] = journal.list()): boolean {
  return entries.some((e) => e.state === 'terminal' && e.pageId !== PAGE_ID);
}
