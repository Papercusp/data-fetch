// @papercusp/data-fetch
//
// Generic versioned read-cache: conditional-GET (If-None-Match/304) over
// @papercusp/kv-persist with stale-while-revalidate. The non-grid, non-Zero
// generalization of "version every query" — a query's version is a scalar
// (ETag / count+max hash) instead of a bloom manifest.
//
// Use for: versionable read-only GETs (categories, product/group detail, the
// scout chat transcript, …). NOT for: mutations, live token streams, or
// auth/session (see the data-fetch-surfaces strategy plan).

export {
  reconcileVersioned,
  httpVersionedFetcher,
} from './versioned-fetch';
export type {
  VersionedEnvelope,
  VersionedResult,
  VersionedFetcher,
  HttpVersionedFetcherOptions,
} from './versioned-fetch';

export { useVersionedResource } from './useVersionedResource';
export type {
  UseVersionedResourceOptions,
  UseVersionedResourceResult,
} from './useVersionedResource';

// Opt-in cache-effectiveness telemetry (IDB hit/miss + 304/200).
export {
  configureCacheTelemetry,
  emitCacheEvent,
  createCacheCounter,
} from './cache-telemetry';
export type {
  CacheTelemetryEvent,
  CacheTelemetryRecord,
  CacheTelemetrySink,
} from './cache-telemetry';

// Imperative cache warmer (call on idle / hover so the first mount is a hit).
export { prewarmVersionedResource } from './prewarm';
export type { PrewarmOptions } from './prewarm';
