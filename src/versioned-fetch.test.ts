import { describe, it, expect, vi } from 'vitest';
import {
  reconcileVersioned,
  httpVersionedFetcher,
  type VersionedEnvelope,
} from './versioned-fetch';

describe('reconcileVersioned', () => {
  it('304 not-modified keeps the cached envelope', () => {
    const cached: VersionedEnvelope<number[]> = { version: 'v1', data: [1, 2] };
    expect(reconcileVersioned(cached, { status: 'not-modified' })).toBe(cached);
  });

  it('304 with no cache is a bug → throws (never serve empty)', () => {
    expect(() => reconcileVersioned(null, { status: 'not-modified' })).toThrow(/304/);
  });

  it('fresh produces a new envelope from the response', () => {
    const next = reconcileVersioned<number[]>(
      { version: 'v1', data: [1] },
      { status: 'fresh', version: 'v2', data: [1, 2, 3] },
    );
    expect(next).toEqual({ version: 'v2', data: [1, 2, 3] });
  });

  it('fresh carries a null version through (un-versioned endpoint)', () => {
    const next = reconcileVersioned<string>(null, { status: 'fresh', version: null, data: 'x' });
    expect(next).toEqual({ version: null, data: 'x' });
  });
});

describe('httpVersionedFetcher', () => {
  function jsonResponse(status: number, body: unknown, etag?: string): Response {
    const headers = new Headers();
    if (etag) headers.set('etag', etag);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers,
      json: async () => body,
    } as unknown as Response;
  }

  it('sends If-None-Match when a version is known; maps 200 → fresh + ETag', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { rows: [1] }, 'W/"abc"'));
    const fetcher = httpVersionedFetcher<{ rows: number[] }>('/x', { fetchImpl });
    const res = await fetcher({ version: 'W/"old"' });
    expect(res).toEqual({ status: 'fresh', version: 'W/"abc"', data: { rows: [1] } });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init!.headers as Headers).get('If-None-Match')).toBe('W/"old"');
  });

  it('omits If-None-Match when no version is known', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, {}, 'W/"abc"'));
    const fetcher = httpVersionedFetcher('/x', { fetchImpl });
    await fetcher({ version: null });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init!.headers as Headers).has('If-None-Match')).toBe(false);
  });

  it('maps 304 → not-modified (no body read)', async () => {
    const json = vi.fn();
    const fetchImpl = vi.fn(async () => ({ status: 304, ok: false, headers: new Headers(), json } as unknown as Response));
    const fetcher = httpVersionedFetcher('/x', { fetchImpl });
    expect(await fetcher({ version: 'W/"abc"' })).toEqual({ status: 'not-modified' });
    expect(json).not.toHaveBeenCalled();
  });

  it('non-304 error status throws (caller keeps the stale cache)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, null));
    const fetcher = httpVersionedFetcher('/x', { fetchImpl });
    await expect(fetcher({ version: null })).rejects.toThrow(/HTTP 500/);
  });

  it('honours parse + readVersion overrides', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { v: 7, items: ['a'] }));
    const fetcher = httpVersionedFetcher<string[]>('/x', {
      fetchImpl,
      parse: (b) => (b as { items: string[] }).items,
      readVersion: (_res, b) => String((b as { v: number }).v),
    });
    expect(await fetcher({ version: null })).toEqual({ status: 'fresh', version: '7', data: ['a'] });
  });
});
