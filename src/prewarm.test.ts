import { describe, it, expect, afterEach, vi } from 'vitest';
import { prewarmVersionedResource } from './prewarm';
import { configureCacheTelemetry } from './cache-telemetry';
import type { VersionedFetcher } from './versioned-fetch';
import type { ResourceRecord } from './versioned-store';
import type { KvStorePersistence } from '@papercusp/kv-persist';

function memPersistence(): KvStorePersistence<ResourceRecord> & { store: Map<string, ResourceRecord> } {
  const store = new Map<string, ResourceRecord>();
  return {
    store,
    load: async () => [...store.values()],
    save: (recs: ResourceRecord[]) => recs.forEach((r) => store.set(r.id, r)),
    clear: () => store.clear(),
  };
}

afterEach(() => configureCacheTelemetry(null));

describe('prewarmVersionedResource', () => {
  it('writes through a fresh result and emits revalidate-200', async () => {
    const p = memPersistence();
    const events: string[] = [];
    configureCacheTelemetry((e) => events.push(e.event));
    const fetcher: VersionedFetcher<{ n: number }> = async () => ({
      status: 'fresh',
      version: 'v1',
      data: { n: 7 },
    });

    await prewarmVersionedResource('k', fetcher, { persistence: p });

    expect(p.store.get('k')).toMatchObject({ id: 'k', version: 'v1', data: { n: 7 } });
    expect(events).toEqual(['revalidate-200']);
  });

  it('sends the cached version and leaves the store untouched on 304', async () => {
    const p = memPersistence();
    p.store.set('k', { id: 'k', v: 1, version: 'v1', data: { n: 1 } });
    const events: string[] = [];
    configureCacheTelemetry((e) => events.push(e.event));
    const fetcher = vi.fn<VersionedFetcher<unknown>>(async ({ version }) => {
      expect(version).toBe('v1'); // it must send the cached version
      return { status: 'not-modified' };
    });

    await prewarmVersionedResource('k', fetcher, { persistence: p });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(p.store.get('k')).toMatchObject({ data: { n: 1 } }); // unchanged
    expect(events).toEqual(['revalidate-304']);
  });

  it('never rejects; a fetcher error emits error', async () => {
    const p = memPersistence();
    const events: string[] = [];
    configureCacheTelemetry((e) => events.push(e.event));
    const fetcher: VersionedFetcher<unknown> = async () => {
      throw new Error('network down');
    };

    await expect(prewarmVersionedResource('k', fetcher, { persistence: p })).resolves.toBeUndefined();
    expect(events).toEqual(['error']);
  });

  it('is a no-op when persistence is disabled', async () => {
    const fetcher = vi.fn<VersionedFetcher<unknown>>(async () => ({ status: 'not-modified' }));
    await prewarmVersionedResource('k', fetcher, { persistence: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
