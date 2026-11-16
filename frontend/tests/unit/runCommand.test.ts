import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { ApiError } from '@/api/errors';
import { CommandJournal } from '@/api/commands/journal';
import { abandonCommand, recoverCommand, runCommand } from '@/api/commands/runCommand';
import { sessionSchema } from '@/api/schemas';
import session1 from '../fixtures/captured/session_rev1_pending.json';

const URL = 'http://backend.test/v1/sessions/s1/recommendations';
const spec = {
  command: 'recommend' as const,
  path: '/v1/sessions/s1/recommendations',
  body: { expected_revision: 0 },
  schema: sessionSchema,
  sessionId: 's1',
  expectedRevision: 0,
};

function memJournal() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return new CommandJournal(storage);
}

describe('runCommand', () => {
  it('sends JSON with an Idempotency-Key, exactly the journaled body, and no Authorization header', async () => {
    const j = memJournal();
    let seen: { key: string | null; ct: string | null; auth: string | null; body: string } | null = null;
    server.use(
      http.post(URL, async ({ request }) => {
        seen = {
          key: request.headers.get('idempotency-key'),
          ct: request.headers.get('content-type'),
          auth: request.headers.get('authorization'),
          body: await request.text(),
        };
        return HttpResponse.json(session1);
      }),
    );
    const r = await runCommand(spec, { journal: j });
    expect(r.value.revision).toBe(1);
    expect(seen).not.toBeNull();
    const s = seen!;
    expect(s.key).toBe(r.key);
    expect(s.key).toMatch(/^pcubfe-v1:recommend:[0-9a-f-]{36}$/);
    expect(s.key!.length).toBeLessThanOrEqual(128);
    expect(s.ct).toContain('application/json');
    expect(s.auth).toBeNull();
    expect(s.body).toBe(j.get(r.key)!.body);
    expect(j.get(r.key)!.state).toBe('committed');
  });

  it('writes the journal entry BEFORE the request leaves (write-ahead)', async () => {
    const j = memJournal();
    let stateDuringRequest: string | undefined;
    server.use(
      http.post(URL, ({ request }) => {
        stateDuringRequest = j.get(request.headers.get('idempotency-key')!)?.state;
        return HttpResponse.json(session1);
      }),
    );
    await runCommand(spec, { journal: j });
    expect(stateDuringRequest).toBe('in_flight');
  });

  it('uses a fresh key for every deliberate command', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => HttpResponse.json(session1)));
    const a = await runCommand(spec, { journal: j });
    const b = await runCommand(spec, { journal: j });
    expect(a.key).not.toBe(b.key);
  });

  it('a backend error is "rejected": nothing committed, key retired, NO retry', async () => {
    const j = memJournal();
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return HttpResponse.json({ error: { code: 'STALE_REVISION' } }, { status: 409 });
      }),
    );
    const err = await runCommand(spec, { journal: j }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('backend');
    expect((err as ApiError).code).toBe('STALE_REVISION');
    expect(calls).toBe(1);
    const e = j.list()[0]!;
    expect(e.state).toBe('rejected');
    expect(e.errorCode).toBe('STALE_REVISION');
    expect(j.recoverable()).toHaveLength(0);
  });

  it('preserves the optional backend `action` text verbatim', async () => {
    const j = memJournal();
    server.use(
      http.post(URL, () =>
        HttpResponse.json({ error: { code: 'PROVIDER_UNKNOWN_COMPLETION', action: 'Stop live operations; preserve the journal.' } }, { status: 409 }),
      ),
    );
    const err = (await runCommand(spec, { journal: j }).catch((e: unknown) => e)) as ApiError;
    expect(err.action).toBe('Stop live operations; preserve the journal.');
  });

  it('lost connection → uncertain; user recovery replays the SAME key and IDENTICAL body', async () => {
    const j = memJournal();
    const seen: { key: string | null; body: string }[] = [];
    let n = 0;
    server.use(
      http.post(URL, async ({ request }) => {
        seen.push({ key: request.headers.get('idempotency-key'), body: await request.text() });
        n++;
        if (n === 1) return HttpResponse.error();
        return HttpResponse.json(session1); // backend replays the committed original
      }),
    );
    const err = (await runCommand(spec, { journal: j }).catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('uncertain');
    const entry = j.recoverable()[0]!;
    expect(entry.state).toBe('uncertain');

    const rec = await recoverCommand(entry.key, sessionSchema, { journal: j });
    expect(rec.replayed).toBe(true);
    expect(rec.value.revision).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.key).toBe(seen[0]!.key);
    expect(seen[1]!.body).toBe(seen[0]!.body);
    expect(j.get(entry.key)!.state).toBe('committed');
  });

  it('there is no automatic replay: an uncertain failure makes exactly one request', async () => {
    const j = memJournal();
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    await runCommand(spec, { journal: j }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it('a proxy 502 with a non-JSON body is uncertain, not "rejected"', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => new HttpResponse('Bad Gateway', { status: 502 })));
    const err = (await runCommand(spec, { journal: j }).catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('uncertain');
    expect(j.list()[0]!.state).toBe('uncertain');
  });

  it('PROVIDER_UNKNOWN_COMPLETION is terminal: it can never be recovered or retried', async () => {
    const j = memJournal();
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return HttpResponse.json({ error: { code: 'PROVIDER_UNKNOWN_COMPLETION' } }, { status: 409 });
      }),
    );
    await runCommand(spec, { journal: j }).catch(() => undefined);
    const e = j.list()[0]!;
    expect(e.state).toBe('terminal');
    expect(j.recoverable()).toHaveLength(0);
    await expect(recoverCommand(e.key, sessionSchema, { journal: j })).rejects.toThrow(/never be retried/i);
    expect(calls).toBe(1);
  });

  it('a 200 whose body breaks the contract is a contract error AND the command stays "committed"', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => HttpResponse.json({ id: 'x' })));
    const err = (await runCommand(spec, { journal: j }).catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('contract');
    expect(err.issues?.length).toBeGreaterThan(0);
    expect(j.list()[0]!.state).toBe('committed');
  });

  it('only uncertain commands can be recovered', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => HttpResponse.json(session1)));
    const r = await runCommand(spec, { journal: j });
    await expect(recoverCommand(r.key, sessionSchema, { journal: j })).rejects.toThrow(/uncertain/);
    await expect(recoverCommand('missing', sessionSchema, { journal: j })).rejects.toThrow(/No journal entry/);
  });

  it('abandon marks an uncertain entry as given up and removes it from recoverable', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => HttpResponse.error()));
    await runCommand(spec, { journal: j }).catch(() => undefined);
    const e = j.recoverable()[0]!;
    abandonCommand(e.key, 'test', j);
    expect(j.get(e.key)!.state).toBe('abandoned');
    expect(j.recoverable()).toHaveLength(0);
  });

  it('refuses to send an over-long idempotency key or an oversized body (frontend guards)', async () => {
    const j = memJournal();
    server.use(http.post(URL, () => HttpResponse.json(session1)));
    const huge = { expected_revision: 0, pad: 'x'.repeat(70_000) };
    const err = (await runCommand({ ...spec, body: huge }, { journal: j }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/exceeds/);
    // Never sent, so it must not be left in flight / recoverable.
    expect(j.list()[0]!.state).toBe('rejected');
    expect(j.recoverable()).toHaveLength(0);
  });
});
