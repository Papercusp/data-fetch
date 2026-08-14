'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KvStorePersistence } from '@papercusp/kv-persist';
import {
  reconcileVersioned,
  type VersionedEnvelope,
  type VersionedFetcher,
} from './versioned-fetch';
import { emitCacheEvent } from './cache-telemetry';
import { ENVELOPE_SCHEMA, sharedPersistence, type ResourceRecord } from './versioned-store';

export interface UseVersionedResourceOptions {
  /**
   * Where to persist the cached envelope. Defaults to a shared IndexedDB store.
   * Pass `false` for memory-only (still SWR within the session, no durable
   * cache) — e.g. auth/session-adjacent data that must not survive a reload.
   */
  persistence?: KvStorePersistence<ResourceRecord> | false;
  /** When false, do not fetch and report nothing (e.g. gate on a logged-in user). */
  enabled?: boolean;
}

export interface UseVersionedResourceResult<T> {
  /** The cached-or-fresh data; `undefined` until the first value lands. */
  data: T | undefined;
  /** The version `data` was fetched at. */
  version: string | null;
  /** True until the first value (cache or network) is available. */
  loading: boolean;
  /** True while a background revalidation is in flight (cache already shown). */
  validating: boolean;
  /** Last fetch error (the stale cache keeps being served alongside it). */
  error: Error | null;
  /** Force a revalidation now (still conditional — a 304 keeps the cache). */
  refresh: () => void;
}

/**
 * Stale-while-revalidate read cache, keyed on a scalar query-version, persisted
 * via @papercusp/kv-persist (IndexedDB by default). On mount it paints instantly
 * from the persisted envelope (if any), then revalidates: sends the cached
 * version, serves the cache on `304`, stores + repaints on `200`.
 *
 * The generic, non-grid / non-Zero member of the data-fetch strategy — for
 * versionable read-only GETs (categories, product/group detail, the scout chat
 * transcript, …). Mutations and live streams do NOT belong here.
 */
export function useVersionedResource<T>(
  key: string,
  fetcher: VersionedFetcher<T>,
  opts: UseVersionedResourceOptions = {},
): UseVersionedResourceResult<T> {
  const enabled = opts.enabled ?? true;
  const persistence =
    opts.persistence === false ? null : opts.persistence ?? sharedPersistence();

  const [envelope, setEnvelope] = useState<VersionedEnvelope<T> | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [validating, setValidating] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Latest envelope mirrored to a ref so revalidate() reads the freshest
  // version without being a dependency (avoids re-running the effect on every
  // data change).
  const envelopeRef = useRef<VersionedEnvelope<T> | null>(null);
  envelopeRef.current = envelope;

  // Fetcher read via a ref so an INLINE fetcher (new identity each render — the
  // common consumer mistake) does NOT re-run the effect / loop. Only `key` (the
  // resource identity) and `enabled` drive refetch; the latest fetcher is used.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // A monotonically-increasing token so a response for a stale key/refresh is
  // ignored (key changed, or a newer refresh superseded this one).
  const reqToken = useRef(0);

  const revalidate = useCallback(
    async (signal?: AbortSignal) => {
      const token = ++reqToken.current;
      setValidating(true);
      try {
        const result = await fetcherRef.current({ version: envelopeRef.current?.version ?? null, signal });
        if (signal?.aborted || token !== reqToken.current) return;
        const next = reconcileVersioned(envelopeRef.current, result);
        if (result.status === 'fresh') {
          setEnvelope(next);
          persistence?.save([{ id: key, v: ENVELOPE_SCHEMA, version: next.version, data: next.data }]);
          emitCacheEvent(key, 'revalidate-200');
        } else {
          emitCacheEvent(key, 'revalidate-304');
        }
        setError(null);
      } catch (err) {
        if (signal?.aborted || token !== reqToken.current) return;
        // Keep serving the stale cache; surface the error alongside it.
        setError(err instanceof Error ? err : new Error(String(err)));
        emitCacheEvent(key, 'error');
      } finally {
        if (token === reqToken.current) {
          setValidating(false);
          setLoading(false);
        }
      }
      // fetcher + envelope read via refs; only key/persistence identify the request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [key, persistence],
  );

  useEffect(() => {
    if (!enabled) {
      setEnvelope(null);
      envelopeRef.current = null;
      setLoading(false);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);

    // 1) Instant paint from the persisted cache (if this key was seen before).
    void (async () => {
      if (persistence) {
        const records = await persistence.load().catch(() => []);
        if (cancelled) return;
        const hit = records.find((r) => r.id === key);
        if (hit) {
          const cached = { version: hit.version, data: hit.data as T };
          setEnvelope(cached);
          envelopeRef.current = cached;
          setLoading(false);
          emitCacheEvent(key, 'idb-hit');
        } else {
          emitCacheEvent(key, 'idb-miss');
        }
      }
      // 2) Revalidate (conditional) regardless of cache hit.
      if (!cancelled) await revalidate(ctrl.signal);
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // Re-run when the key changes or enablement flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, revalidate]);

  const refresh = useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return {
    data: envelope?.data,
    version: envelope?.version ?? null,
    loading,
    validating,
    error,
    refresh,
  };
}
