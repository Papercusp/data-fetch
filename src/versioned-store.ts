// The IndexedDB persistence shared by the versioned read-cache. React-free, so
// both the hook (useVersionedResource) and the imperative warmer
// (prewarmVersionedResource) can use it without dragging React into a util.

import { createIndexedDbPersistence } from '@papercusp/kv-persist-indexeddb';
import type { KvStorePersistence, Versioned } from '@papercusp/kv-persist';

// Envelope persisted per resource: the kv-persist record `id` is the resource
// key, `v` is the envelope-schema constant (freshness is handled by the
// conditional GET, NOT by `v`), and `version`+`data` are the cached payload.
export const ENVELOPE_SCHEMA = 1;
export interface ResourceRecord extends Versioned {
  /** Scalar resource version (ETag/hash) — distinct from the kv-persist `v`. */
  version: string | null;
  data: unknown;
}

// One shared IndexedDB store for every versioned resource, keyed by resource
// key. Lazily created and SSR-safe (no-ops when `indexedDB` is unavailable).
let SHARED: KvStorePersistence<ResourceRecord> | null = null;
export function sharedPersistence(): KvStorePersistence<ResourceRecord> {
  if (!SHARED) {
    SHARED = createIndexedDbPersistence<ResourceRecord>({
      dbName: 'restart-data-fetch',
      storeName: 'resources',
      schemaVersion: ENVELOPE_SCHEMA,
    });
  }
  return SHARED;
}
