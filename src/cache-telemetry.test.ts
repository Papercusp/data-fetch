import { describe, it, expect, afterEach } from 'vitest';
import { configureCacheTelemetry, emitCacheEvent, createCacheCounter } from './cache-telemetry';

afterEach(() => configureCacheTelemetry(null));

describe('cache-telemetry', () => {
  it('delivers events to the configured sink', () => {
    const seen: unknown[] = [];
    configureCacheTelemetry((r) => seen.push(r));
    emitCacheEvent('k1', 'idb-hit');
    emitCacheEvent('k2', 'revalidate-304');
    expect(seen).toEqual([
      { key: 'k1', event: 'idb-hit' },
      { key: 'k2', event: 'revalidate-304' },
    ]);
  });

  it('is a no-op when no sink is configured', () => {
    expect(() => emitCacheEvent('k', 'idb-miss')).not.toThrow();
  });

  it('swallows sink errors so the cache path never breaks', () => {
    configureCacheTelemetry(() => {
      throw new Error('boom');
    });
    expect(() => emitCacheEvent('k', 'error')).not.toThrow();
  });

  it('createCacheCounter aggregates hit + not-modified rates', () => {
    const counter = createCacheCounter();
    configureCacheTelemetry(counter.sink);
    emitCacheEvent('a', 'idb-hit');
    emitCacheEvent('b', 'idb-miss');
    emitCacheEvent('c', 'idb-hit');
    emitCacheEvent('d', 'revalidate-304');
    const snap = counter.snapshot();
    expect(snap['idb-hit']).toBe(2);
    expect(snap.idbHitRate).toBeCloseTo(2 / 3); // 2 hits / (2 hits + 1 miss)
    expect(snap.notModifiedRate).toBe(1); // 1 of 1 revalidation was a 304
  });
});
