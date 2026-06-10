/** Browser half of the shared Agent Deck auth contract. */

export const AUTH_TOKEN_STORAGE_KEY = 'agent-deck:auth-token'

type Listener = () => void

const listeners = new Set<Listener>()
let memoryToken: string | undefined

function readStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function normalizeToken(token: string | null | undefined): string | undefined {
  const trimmed = token?.trim()
  return trimmed ? trimmed : undefined
}

function emitTokenChange(): void {
  for (const listener of listeners) listener()
}

/**
 * The locally-entered auth token, or `undefined` when absent/empty. Remote
 * clients must enter the operator token once; loopback clients usually have none.
 */
export function getAuthToken(): string | undefined {
  const stored = normalizeToken(readStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY))
  return stored ?? memoryToken
}

/** Save a token for future fetches/socket handshakes. */
export function setAuthToken(token: string): void {
  const normalized = normalizeToken(token)
  memoryToken = normalized
  const storage = readStorage()
  try {
    if (normalized) storage?.setItem(AUTH_TOKEN_STORAGE_KEY, normalized)
    else storage?.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    // Private-mode/quota failures still keep the in-memory token for this tab.
  }
  emitTokenChange()
}

/** Clear the saved token after logout or a rejected verification. */
export function clearAuthToken(): void {
  memoryToken = undefined
  try {
    readStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    // Ignore storage failures; the in-memory token has already been cleared.
  }
  emitTokenChange()
}

/** Subscribe to local token changes for small React gates. */
export function subscribeAuthToken(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Verify a candidate token against the gated BFF probe. The token is sent only in
 * this request; it is persisted after the probe succeeds.
 */
export async function verifyAuthToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const normalized = normalizeToken(token)
  if (!normalized) return false
  try {
    const res = await fetchImpl('/api/agent-deck/auth/check', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${normalized}` },
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * `Authorization` header object when a token is present, else an empty object —
 * spread into a fetch `headers` map so loopback sends nothing.
 */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Socket.IO handshake `auth` payload when a token is present, else `undefined`
 * so loopback handshakes carry no auth.
 */
export function socketAuth(): { token: string } | undefined {
  const token = getAuthToken()
  return token ? { token } : undefined
}

export {}
