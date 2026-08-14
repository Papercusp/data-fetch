// Transport-agnostic core of the versioned read-cache. Pure + testable: no
// React, no IndexedDB. The hook (useVersionedResource) wires these to React
// state + @papercusp/kv-persist persistence.
//
// The model: a query result carries a scalar VERSION (an ETag, or a
// `count+max(updated_at)` hash — see the server side). The client keeps the
// last {version, data} and, on revalidate, asks the server "still <version>?"
// via If-None-Match. The server answers 304 (not-modified → serve cache, zero
// body) or 200 (fresh data + a new version). This is the non-grid, non-Zero
// generalization of "version every query".

/** A cached resource: the data plus the version it was fetched at. */
export interface VersionedEnvelope<T> {
  /** Scalar version (ETag / hash). `null` = never-versioned (always refetch). */
  version: string | null;
  data: T;
}

/** The outcome of a conditional fetch. */
export type VersionedResult<T> =
  | { status: 'fresh'; version: string | null; data: T }
  | { status: 'not-modified' };

/**
 * A transport that conditionally fetches a resource. Given the caller's last
 * known version, it returns fresh data (+ the new version) or `not-modified`.
 * `httpVersionedFetcher` is the default HTTP implementation; callers may supply
 * their own (e.g. a sync/RPC transport) as long as it honours the contract.
 */
export type VersionedFetcher<T> = (ctx: {
  version: string | null;
  signal?: AbortSignal;
}) => Promise<VersionedResult<T>>;

/**
 * Fold a fetch result into the next envelope, given the current cache.
 * - `not-modified` keeps the cached envelope — which MUST exist. A 304 with no
 *   cache is a server/caller bug (we asked with no version yet got told
 *   "unchanged"); surface it rather than silently returning empty.
 * - `fresh` produces a new envelope from the response.
 */
export function reconcileVersioned<T>(
  cached: VersionedEnvelope<T> | null,
  result: VersionedResult<T>,
): VersionedEnvelope<T> {
  if (result.status === 'not-modified') {
    if (!cached) {
      throw new Error('versioned-fetch: 304 Not Modified received with no cached value to serve');
    }
    return cached;
  }
  return { version: result.version, data: result.data };
}

export interface HttpVersionedFetcherOptions<T> {
  /** Extra request init (method/headers/body/credentials). */
  init?: RequestInit;
  /** Map the parsed JSON body → T (default: identity). */
  parse?: (body: unknown) => T;
  /** Read the new version from the 200 response (default: the `ETag` header). */
  readVersion?: (res: Response, body: unknown) => string | null;
  /** Injectable fetch (tests / non-global environments). */
  fetchImpl?: typeof fetch;
}

/**
 * A {@link VersionedFetcher} backed by an HTTP conditional GET. Sends
 * `If-None-Match: <version>` when a version is known; maps `304` →
 * `not-modified`, a 2xx → `fresh` (+ the ETag, by default). Non-304 errors
 * throw so the hook can surface them and keep serving the stale cache.
 */
export function httpVersionedFetcher<T>(
  url: string,
  opts: HttpVersionedFetcherOptions<T> = {},
): VersionedFetcher<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const parse = opts.parse ?? ((b: unknown) => b as T);
  const readVersion = opts.readVersion ?? ((res: Response) => res.headers.get('etag'));
  return async ({ version, signal }) => {
    const headers = new Headers(opts.init?.headers);
    if (version != null) headers.set('If-None-Match', version);
    // `no-store` (overridable) so the browser's HTTP cache doesn't shadow the
    // app-level conditional GET — useVersionedResource owns the version logic
    // (its own If-None-Match → 304) and the IndexedDB cache. Without this the
    // browser may serve a stale cached response (and a stale, possibly
    // unreadable ETag) from its own max-age window. The server's Cache-Control
    // still benefits the CDN / SSR / non-app consumers.
    const res = await doFetch(url, { cache: 'no-store', ...opts.init, headers, signal });
    if (res.status === 304) return { status: 'not-modified' };
    if (!res.ok) throw new Error(`versioned-fetch: HTTP ${res.status} for ${url}`);
    const body = await res.json().catch(() => undefined);
    return { status: 'fresh', version: readVersion(res, body), data: parse(body) };
  };
}
