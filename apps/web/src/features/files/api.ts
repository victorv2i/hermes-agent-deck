/**
 * Files surface — typed BFF client.
 *
 * Talks to the agent-deck BFF (proxied at `/api/agent-deck/files/*`). Reads ride
 * the dashboard's read-only workspace API behind the BFF; writes hit the BFF's
 * own path-guarded filesystem routes. Types mirror the server's feature-local
 * shapes (apps/server/src/files/types.ts) — kept local to keep features decoupled.
 */

import { apiFetch, apiPost, ApiError, API_BASE } from '@/lib/apiFetch'
import { authHeaders } from '@/lib/authToken'

const BASE = '/files'

export interface FileRoot {
  id: string
  label: string
  description: string
  path: string
  readOnly: boolean
}

export interface FileEntry {
  name: string
  /** Root-relative POSIX path. */
  path: string
  type: 'dir' | 'file'
  modified: string | null
  size: number | null
  suppressed: boolean
  reason: string | null
  /** "full" | "bounded" | "none" | null (dirs). */
  preview: string | null
}

export interface FileListing {
  root: string
  path: string
  entries: FileEntry[]
  truncated: boolean
}

export interface FileContent {
  root: string
  path: string
  content: string
  encoding: string
  size: number
  modified: string | null
  mime: string
  previewMode: string
  truncated: boolean
  /** True for a binary file (no decoded content; UI shows a binary state, no Edit). */
  binary: boolean
}

export interface FileMutationResult {
  root: string
  path: string
  size?: number
  modified?: string | null
}

/** A BFF error carrying the HTTP status + machine code, so the UI can show a
 * calm, specific message (403 sensitive vs 404 missing, etc.). Extends the
 * shared {@link ApiError} so the converged apiFetch error path produces it,
 * while keeping the named class for the Files surface's `instanceof` checks. */
export class FilesApiError extends ApiError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, code)
    this.name = 'FilesApiError'
  }
}

const filesError = (message: string, status: number, code?: string): FilesApiError =>
  new FilesApiError(message, status, code)

/** GET JSON under the files BFF, raising a {@link FilesApiError} on a non-2xx. */
function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(path, { signal, errorFactory: filesError })
}

/** POST JSON under the files BFF, raising a {@link FilesApiError} on a non-2xx. */
function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiPost<T>(path, body, { errorFactory: filesError })
}

export function fetchRoots(signal?: AbortSignal): Promise<{ roots: FileRoot[] }> {
  return getJson(`${BASE}/roots`, signal)
}

export function fetchListing(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileListing> {
  const qs = new URLSearchParams({ root, path })
  return getJson(`${BASE}?${qs.toString()}`, signal)
}

export function fetchFile(root: string, path: string, signal?: AbortSignal): Promise<FileContent> {
  const qs = new URLSearchParams({ root, path })
  return getJson(`${BASE}/read?${qs.toString()}`, signal)
}

export function writeFile(
  root: string,
  path: string,
  content: string,
): Promise<FileMutationResult> {
  return postJson(`${BASE}/write`, { root, path, content })
}

export function createEntry(
  root: string,
  path: string,
  kind: 'file' | 'dir',
): Promise<FileMutationResult> {
  return postJson(`${BASE}/create`, { root, path, kind })
}

export function renameEntry(root: string, from: string, to: string): Promise<FileMutationResult> {
  return postJson(`${BASE}/rename`, { root, from, to })
}

export function deleteEntry(root: string, path: string): Promise<FileMutationResult> {
  return postJson(`${BASE}/delete`, { root, path })
}

/** Absolute URL for the BFF raw-image route (used as an `<img>`-style source).
 * The route is auth-gated like every other `/api/*` path, so an `<img src>`
 * (which cannot carry an Authorization header) would 401 on a non-loopback bind
 * — use {@link fetchRawImageObjectUrl}, which fetches the bytes WITH the bearer
 * token and hands back an object URL. */
export function rawImageUrl(root: string, path: string): string {
  const qs = new URLSearchParams({ root, path })
  return `${API_BASE}${BASE}/raw?${qs.toString()}`
}

/**
 * Fetch a raw image through the auth-gated BFF and return a blob object URL the
 * caller assigns to an `<img src>`. This is the C1-correct path for image
 * previews: it sends `Authorization: Bearer <token>` (via {@link authHeaders})
 * on a non-loopback bind, where a bare `<img src>` could not. On loopback the
 * header map is empty, so behavior is unchanged. The caller MUST revoke the
 * returned URL (URL.revokeObjectURL) when the image unmounts/changes.
 */
export async function fetchRawImageObjectUrl(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  // This is the one binary (non-JSON) route, so it can't ride apiFetch's JSON
  // parse — but it shares the same auth + typed-error contract.
  const res = await fetch(rawImageUrl(root, path), {
    signal,
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    let code: string | undefined
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string; code?: string; message?: string }
      code = body.code ?? body.error
      const detail = body.message ?? body.error
      if (detail) message = detail
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new FilesApiError(message, res.status, code)
  }
  return URL.createObjectURL(await res.blob())
}

/** Absolute URL for the BFF guarded download route. Like the raw route it is
 * auth-gated, so it is fetched WITH the bearer token (not navigated to directly)
 * by {@link downloadFile}. */
export function downloadUrl(root: string, path: string): string {
  const qs = new URLSearchParams({ root, path })
  return `${API_BASE}${BASE}/download?${qs.toString()}`
}

/**
 * Download a non-sensitive file through the auth-gated BFF and save it via a
 * transient anchor. Mirrors {@link fetchRawImageObjectUrl}: it sends
 * `Authorization: Bearer <token>` (via {@link authHeaders}) so the download works
 * on a non-loopback bind where a bare `<a download href>` could not authenticate.
 * The server already path-guards + size-caps + forces `attachment`; this just
 * fetches the bytes and lets the browser save them under the given filename.
 */
export async function downloadFile(root: string, path: string, filename: string): Promise<void> {
  const res = await fetch(downloadUrl(root, path), { headers: { ...authHeaders() } })
  if (!res.ok) {
    let code: string | undefined
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string; code?: string; message?: string }
      code = body.code ?? body.error
      const detail = body.message ?? body.error
      if (detail) message = detail
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new FilesApiError(message, res.status, code)
  }
  const objectUrl = URL.createObjectURL(await res.blob())
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Heuristics for the preview pane. */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isImageName(name: string): boolean {
  return IMAGE_EXT.has(extensionOf(name))
}

export function isMarkdownName(name: string): boolean {
  const ext = extensionOf(name)
  return ext === 'md' || ext === 'markdown'
}
