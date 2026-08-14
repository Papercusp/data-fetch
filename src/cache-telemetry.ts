// Opt-in telemetry seam for useVersionedResource. Lets a consumer observe cache
// effectiveness — IndexedDB hit/miss on mount + conditional-GET 304/200 on
// revalidation — and forward it to analytics. Default is a no-op; register a
// sink with `configureCacheTelemetry`. The cache path never depends on this.

export type CacheTelemetryEvent =
  | 'idb-hit' //        mount painted instantly from the IndexedDB cache
  | 'idb-miss' //       mount found no cached record (first visit / evicted)
  | 'revalidate-304' // conditional GET returned Not Modified (cheap hit, no body)
  | 'revalidate-200' // conditional GET returned fresh data (repaint + write-through)
  | 'error'; //         revalidation failed (the stale cache is kept)

export interface CacheTelemetryRecord {
  /** The resource key, e.g. 'returns:cust_123'. */
  key: string;
  event: CacheTelemetryEvent;
}

export type CacheTelemetrySink = (record: CacheTelemetryRecord) => void;

let sink: CacheTelemetrySink | null = null;

/** Register (or clear, with `null`) the telemetry sink. Last wins. */
export function configureCacheTelemetry(next: CacheTelemetrySink | null): void {
  sink = next;
}

/** Emit a cache event. No-op when no sink is configured; never throws. */
export function emitCacheEvent(key: string, event: CacheTelemetryEvent): void {
  if (!sink) return;
  try {
    sink({ key, event });
  } catch {
    /* a broken sink must never break the cache path */
  }
}

/**
 * A ready-made in-memory aggregator for quick measurement: wire `counter.sink`
 * via {@link configureCacheTelemetry} and read `counter.snapshot()` to log a
 * hit rate. `idbHitRate` = idb-hit / (idb-hit + idb-miss); `notModifiedRate` =
 * 304 / (304 + 200) — high values on both mean the cache is doing its job.
 */
export function createCacheCounter() {
  const counts: Record<CacheTelemetryEvent, number> = {
    'idb-hit': 0,
    'idb-miss': 0,
    'revalidate-304': 0,
    'revalidate-200': 0,
    error: 0,
  };
  const counterSink: CacheTelemetrySink = ({ event }) => {
    counts[event] += 1;
  };
  return {
    sink: counterSink,
    snapshot() {
      const mounts = counts['idb-hit'] + counts['idb-miss'];
      const revalidations = counts['revalidate-304'] + counts['revalidate-200'];
      return {
        ...counts,
        idbHitRate: mounts ? counts['idb-hit'] / mounts : 0,
        notModifiedRate: revalidations ? counts['revalidate-304'] / revalidations : 0,
      };
    },
  };
}
