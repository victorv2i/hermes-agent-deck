/**
 * The ONE BFF client primitive. Before this, six feature `api.ts` files each
 * re-implemented the same three things — `authHeaders()` spread, the `if
 * (!res.ok) throw` ok-check, and a bespoke error-body parse — in three slightly
 * different error shapes. `apiFetch` converges them: auth, the ok-check, and a
 * single typed {@link ApiError} (status + machine code + human message) live
 * here, so every surface fails the same calm, specific way and a future header
 * or error-policy change is a one-line edit.
 *
 * Paths: a bare path (`/models`) is resolved under the BFF base
 * (`/api/agent-deck`); an already-absolute `/api/...` path is passed through
 * unchanged (Vite proxies `/api` to the BFF in dev; same-origin in prod).
 */
import { authHeaders } from './authToken'
import { signalSessionExpired } from './sessionExpired'

/** The BFF mount. Same-origin; Vite proxies `/api` to the dashboard/gateway BFF. */
export const API_BASE = '/api/agent-deck'

/**
 * A BFF error carrying the HTTP status + optional machine `code`, so a surface
 * can show a specific message (403 sensitive vs 404 missing) and a retry policy
 * can skip permanent 4xx. One shared shape across every surface.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
  /** Extra headers merged AFTER the auth header (so callers can add Accept etc.). */
  headers?: Record<string, string>
  /** Build a surface-specific error subclass from the parsed body (e.g. Files). */
  errorFactory?: (message: string, status: number, code?: string) => ApiError
}

/** Resolve a bare path under the BFF base; pass an absolute `/api/...` through. */
function resolveUrl(path: string): string {
  if (path.startsWith('/api/')) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

/** Parse a non-ok response body into a typed error and throw it. */
async function throwError(
  res: Response,
  make: (message: string, status: number, code?: string) => ApiError,
): Promise<never> {
  let code: string | undefined
  let message = `Request failed (${res.status})`
  try {
    const body = (await res.json()) as { error?: string; code?: string; message?: string }
    code = body.code ?? body.error
    // Prefer an explicit human `message`; otherwise surface the BFF's `error`
    // detail so the failure is specific. Either way the message is CLEAN (no
    // status prefix) — surfaces that want the status read it off `err.status`,
    // and Files renders `err.message` verbatim as its user-facing reason.
    const detail = body.message ?? body.error
    if (detail) message = detail
  } catch {
    // Non-JSON error body — keep the generic, status-bearing message.
  }
  throw make(message, res.status, code)
}

/** Core fetch: auth headers + ok-check + typed-error parse, returning JSON. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { headers, errorFactory, ...init } = options
  const make = errorFactory ?? ((m, s, c) => new ApiError(m, s, c))
  const res = await fetch(resolveUrl(path), {
    ...init,
    headers: { Accept: 'application/json', ...authHeaders(), ...headers },
  })
  if (!res.ok) {
    if (res.status === 401) signalSessionExpired()
    return throwError(res, make)
  }
  return (await res.json()) as T
}

/** POST JSON convenience wrapper over {@link apiFetch}. */
export function apiPost<T>(path: string, body: unknown, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  })
}

/** PATCH JSON convenience wrapper over {@link apiFetch}. */
export function apiPatch<T>(
  path: string,
  body: unknown,
  options: ApiFetchOptions = {},
): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  })
}

/** DELETE convenience wrapper over {@link apiFetch} (no request body). */
export function apiDelete<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'DELETE' })
}
