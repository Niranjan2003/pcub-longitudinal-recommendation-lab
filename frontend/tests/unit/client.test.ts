import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { getCapabilities, getComparison, getRecipe, getReferenceResultsR1, getSession } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import capabilities from '../fixtures/captured/capabilities.json';
import recipe from '../fixtures/captured/recipe_249560.json';

const B = 'http://backend.test';

describe('GET endpoints', () => {
  it('parses a valid capabilities response', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.json(capabilities)));
    expect((await getCapabilities()).mode).toBe('offline');
  });

  it('encodes recipe ids as a single path component', async () => {
    let path = '';
    server.use(
      http.get(`${B}/v1/recipes/:id`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(recipe);
      }),
    );
    await getRecipe('a/b c');
    expect(path).toBe('/v1/recipes/a%2Fb%20c');
  });

  it('maps a backend JSON error to a typed backend ApiError with its code', async () => {
    server.use(http.get(`${B}/v1/sessions/:id`, () => HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })));
    const e = (await getSession('nope').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.kind).toBe('backend');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.status).toBe(404);
  });

  it('maps an unreachable backend (network failure) to kind "network"', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => HttpResponse.error()));
    const e = (await getCapabilities().catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('network');
  });

  it('treats a proxy 5xx with a non-JSON body as "network" for a GET', async () => {
    server.use(http.get(`${B}/v1/capabilities`, () => new HttpResponse('proxy error', { status: 500 })));
    const e = (await getCapabilities().catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('network');
  });

  it('turns a malformed 200 into a visible contract error, never partial data', async () => {
    server.use(http.get(`${B}/v1/branch-comparisons/:id`, () => HttpResponse.json({ id: 'x', status: 'complete' })));
    const e = (await getComparison('x').catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('contract');
    expect(e.issues?.length).toBeGreaterThan(0);
    expect(e.raw).toEqual({ id: 'x', status: 'complete' });
  });

  it('never sends an Authorization header or a request body on GET', async () => {
    let auth: string | null = 'unset';
    server.use(
      http.get(`${B}/v1/reference-results/r1`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({ world_kind: 'reference_replay', reference_run_fingerprint: 'f', formal_closure_present: false, claim: 'c', tables: {} });
      }),
    );
    const r = await getReferenceResultsR1();
    expect(auth).toBeNull();
    expect(r.formal_closure_present).toBe(false);
  });
});
