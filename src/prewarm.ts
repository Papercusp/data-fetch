// Imperatively warm the versioned read-cache without mounting the hook — call
// on idle (requestIdleCallback) or on hover/intent so the FIRST
// useVersionedResource mount for that key is an instant IndexedDB hit instead
// of a cold fetch. Mirrors the hook's revalidate path (conditional fetch using
// any cached version, write-through on fresh), minus all the React state.

import type { KvStorePersistence } from '@papercusp/kv-persist';
import type { VersionedFetcher } from './versioned-fetch';
import { ENVELOPE_SCHEMA, sharedPersistence, type ResourceRecord } from './versioned-store';
import { emitCacheEvent } from './cache-telemetry';

export interface PrewarmOptions {
  /** Where to write the warmed envelope. Defaults to the shared IndexedDB store. */
  persistence?: KvStorePersistence<ResourceRecord> | false;
  signal?: AbortSignal;
}

/**
 * Warm `key` in the cache. Resolves once the conditional fetch settles; never
 * rejects (warming is best-effort). A `304` leaves the cache untouched; a
 * `fresh` 200 writes through so the next mount paints it instantly.
 */
export async function prewarmVersionedResource<T>(
  key: string,
  fetcher: VersionedFetcher<T>,
  opts: PrewarmOptions = {},
): Promise<void> {
  const persistence = opts.persistence === false ? null : opts.persistence ?? sharedPersistence();
  if (!persistence) return; // nothing durable to warm
  try {
    const records = await persistence.load().catch(() => []);
    if (opts.signal?.aborted) return;
    const hit = records.find((r) => r.id === key);
    const result = await fetcher({ version: hit?.version ?? null, signal: opts.signal });
    if (opts.signal?.aborted) return;
    if (result.status === 'fresh') {
      persistence.save([{ id: key, v: ENVELOPE_SCHEMA, version: result.version, data: result.data }]);
      emitCacheEvent(key, 'revalidate-200');
    } else {
      emitCacheEvent(key, 'revalidate-304');
    }
  } catch {
    emitCacheEvent(key, 'error');
  }
}
