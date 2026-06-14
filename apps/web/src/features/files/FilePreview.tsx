/**
 * FilePreview — the right pane of the Files surface.
 *
 * Read mode reuses the M1b chat vocabulary: Markdown for `.md`, CodeBlock for
 * code/text, an <img> for images, and a calm indicator for binary/unsupported
 * files. Edit mode swaps in a lazily-loaded CodeMirror editor with Save / Cancel.
 *
 * The editor (CodeMirror runtime + language grammars) is code-split via
 * React.lazy so it only downloads when the user clicks Edit — first paint of the
 * surface stays lean.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { Download, FileSearch, FileWarning, Loader2, Lock, Pencil, Save, X } from 'lucide-react'
import { Markdown } from '@/components/chat/Markdown'
import { normalizeLang } from '@/components/chat/lib/highlight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeView } from './CodeView'
import {
  downloadFile,
  extensionOf,
  fetchRawImageObjectUrl,
  isImageName,
  isMarkdownName,
  type FileContent,
} from './api'

const CodeEditor = lazy(() => import('./CodeEditor'))

export interface FilePreviewProps {
  root: string
  /** Open file's root-relative path, or null for the empty state. */
  path: string | null
  /** Resolved content; null while loading or for the empty state. */
  content: FileContent | null
  loading: boolean
  /** A load error (e.g. 403 sensitive, 404 missing, binary/unsupported). */
  error?: string | null
  /** Selected entry preview capability hint ("none" => binary/unsupported). */
  previewHint?: string | null
  saving: boolean
  saveError?: string | null
  /**
   * I1 (read-only Files): when the active root is read-only, the Edit/Save
   * affordance is disabled with an honest tooltip (writes are 403'd server-side
   * in v1). Defaults to read-only-unknown = editable; the route passes the
   * active root's flag.
   */
  readOnly?: boolean
  /** Persist edited text; resolves when the save round-trips. */
  onSave: (next: string) => Promise<void>
  /** Report unsaved-edit state up so the parent can guard a file switch (and a
   * tab close) against silently discarding the draft. Fired on every change to
   * `dirty`, and `false` on unmount. */
  onDirtyChange?: (dirty: boolean) => void
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx + 1)
}

/** A short, lowercase language label for the header pill (e.g. " typescript",
 * else the bare extension, else "text"). Mirrors CodeBlock's label logic so the
 * pill reads consistently with the chat surface. */
function langLabel(name: string): string {
  const ext = extensionOf(name)
  return normalizeLang(ext) ?? (ext || 'text')
}

export function FilePreview({
  root,
  path,
  content,
  loading,
  error,
  previewHint,
  saving,
  saveError,
  readOnly = false,
  onSave,
  onDirtyChange,
}: FilePreviewProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // C1 image preview (object URL from an authenticated fetch); populated by the
  // effect below and cleared by the render-time reset when a different file opens.
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Reset edit state when a different file opens, using React's
  // adjust-state-during-render pattern (no effect → no cascading render).
  const fileKey = `${root}\u0000${path ?? ''}`
  const [lastFileKey, setLastFileKey] = useState(fileKey)
  if (fileKey !== lastFileKey) {
    setLastFileKey(fileKey)
    setEditing(false)
    setImageUrl(null)
    setImageError(null)
    setDownloadError(null)
  }

  const beginEditing = () => {
    if (content) setDraft(content.content)
    setEditing(true)
  }

  // Download the open file through the auth-gated, path-guarded BFF route. Works
  // for any file type (text, code, image, binary) — the bytes are saved as-is.
  const handleDownload = async () => {
    if (path === null || downloading) return
    setDownloadError(null)
    setDownloading(true)
    try {
      await downloadFile(root, path, basename(path))
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download file')
    } finally {
      setDownloading(false)
    }
  }

  // C1: image previews ride the auth-gated /files/raw route, which an <img src>
  // cannot authenticate on a non-loopback bind. Fetch the bytes WITH the bearer
  // token (authHeaders) into a blob object URL and assign THAT to the <img>; on
  // loopback the header map is empty, so behavior is unchanged. The render-time
  // reset above clears prior state; this effect only writes inside async
  // callbacks, and revokes the object URL on unmount/file change so no blob leaks.
  const showImage = path !== null && isImageName(basename(path))
  useEffect(() => {
    if (!showImage || path === null) return
    let objectUrl: string | null = null
    const controller = new AbortController()
    fetchRawImageObjectUrl(root, path, controller.signal)
      .then((url) => {
        objectUrl = url
        setImageUrl(url)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setImageError(err instanceof Error ? err.message : 'Failed to load image')
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [root, path, showImage])

  // Unsaved-edit state, reported up so the parent can guard a file switch / tab
  // close (a path change here silently resets `editing`, losing the draft).
  // Computed and reported BEFORE the early returns below so the hook order stays
  // stable across the empty and loaded states. The parent's handler is a stable
  // setter, so the dep is steady; the cleanup clears the flag on unmount.
  const dirty = editing && content !== null && draft !== content.content
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <span
          aria-hidden
          className="ad-surface grid size-11 place-items-center rounded-xl bg-surface-1 text-foreground-tertiary"
        >
          <FileSearch className="size-5" />
        </span>
        <p className="max-w-xs text-sm leading-relaxed text-foreground-tertiary">
          Select a file to preview it here. Text and code render inline; click Edit to make changes.
        </p>
      </div>
    )
  }

  const name = basename(path)
  const dir = dirname(path)
  const isImage = isImageName(name)
  // Binary is detected two ways: the listing hint ("none", before content loads)
  // OR the authoritative server flag on the loaded content (a `slice.toString`
  // would be mojibake). Either way we show an honest binary state, never Edit.
  const isBinary = (previewHint === 'none' && !content) || content?.binary === true
  const isMarkdown = isMarkdownName(name)
  // Code rendering is the fallback when there's text content that isn't markdown
  // or an image — that's when the language pill + line numbers apply.
  const isCode = !error && !isImage && !isBinary && content !== null && !isMarkdown

  const saveDraft = async () => {
    if (!dirty || saving) return
    await onSave(draft)
    setEditing(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="file-preview">
      {/* Header: language pill · filename (+ dir context) · actions */}
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        {(isCode || (editing && !isMarkdown)) && (
          <Badge variant="muted" className="shrink-0 font-mono lowercase">
            {langLabel(name)}
          </Badge>
        )}
        <span className="flex min-w-0 items-baseline gap-1" title={path}>
          {dir && (
            <span className="hidden truncate font-mono text-xs text-foreground-tertiary sm:inline">
              {dir}
            </span>
          )}
          <span className="truncate font-mono text-xs font-medium text-foreground">{name}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Download is available for ANY open file (text/code/image/binary):
              the BFF streams the saved bytes via a guarded `attachment` route.
              Hidden while editing (you'd save the draft first — the download is
              of what's on disk) and when the file failed to load (nothing to get). */}
          {!editing && !error && path !== null && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleDownload}
              disabled={downloading}
              title="Download"
            >
              {downloading ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              Download
            </Button>
          )}
          {/* T1.9 — honest read-only state: on a read-only root we never render
              a fake-enabled (or quietly-disabled) Edit button whose only signal
              is a native title. Instead, a visible "Read-only" badge states the
              fact plainly. Edit only appears where a write would actually land. */}
          {!editing && content && !isImage && !isBinary && readOnly && (
            <Badge variant="muted" data-slot="read-only-badge" className="shrink-0">
              <Lock className="size-3" aria-hidden />
              Read-only
            </Badge>
          )}
          {/* Edit is gated on a BINARY file too: there is no decoded text to edit,
              and a Save would clobber the bytes — show the binary state instead. */}
          {!editing && content && !isImage && !isBinary && !readOnly && (
            <Button
              variant="ghost"
              size="xs"
              onClick={beginEditing}
              disabled={content.truncated}
              title={content.truncated ? 'File too large to edit safely' : 'Edit'}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button variant="ghost" size="xs" onClick={() => setEditing(false)} disabled={saving}>
                <X aria-hidden />
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={saveDraft}
                disabled={!dirty || saving}
                aria-keyshortcuts="Meta+S Control+S"
                title="Save (Ctrl/Cmd+S)"
              >
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <p
          role="alert"
          className="border-b border-border bg-destructive/5 px-5 py-2 text-xs text-destructive"
        >
          {saveError}
        </p>
      )}

      {downloadError && (
        <p
          role="alert"
          className="border-b border-border bg-destructive/5 px-5 py-2 text-xs text-destructive"
        >
          {downloadError}
        </p>
      )}

      {/* Body. Each branch owns its own padding so code can run edge-to-edge with
          a line-number gutter while prose/images stay comfortably inset. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center"
          >
            <FileWarning className="size-7 text-foreground-tertiary" aria-hidden />
            <p className="text-sm text-foreground-tertiary">{error}</p>
          </div>
        ) : isImage ? (
          <div className="flex h-full items-center justify-center p-6">
            {imageError ? (
              <div role="alert" className="flex flex-col items-center gap-3 text-center">
                <FileWarning className="size-7 text-foreground-tertiary" aria-hidden />
                <p className="text-sm text-foreground-tertiary">{imageError}</p>
              </div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={name}
                className="max-h-full max-w-full rounded-xl object-contain ring-1 ring-border"
              />
            ) : (
              <Loader2 className="size-5 animate-spin text-foreground-tertiary" />
            )}
          </div>
        ) : isBinary ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
            <FileWarning className="size-7 text-foreground-tertiary" aria-hidden />
            <p className="text-sm text-foreground-tertiary">
              Binary or unsupported file: no preview available.
            </p>
          </div>
        ) : loading || !content ? (
          <div className="space-y-2.5 px-6 py-5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted/50"
                style={{ width: `${90 - i * 8}%` }}
              />
            ))}
          </div>
        ) : editing ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-foreground-tertiary">
                <Loader2 className="size-5 animate-spin" />
              </div>
            }
          >
            <CodeEditor
              value={draft}
              onChange={setDraft}
              onSave={dirty && !saving ? saveDraft : undefined}
              filename={name}
            />
          </Suspense>
        ) : isMarkdown ? (
          <div className="ad-prose px-6 py-5">
            <Markdown>{content.content}</Markdown>
          </div>
        ) : (
          <CodeView code={content.content} lang={extensionOf(name) || 'text'} />
        )}
      </div>

      {content?.truncated && !editing && (
        <p className="border-t border-border px-5 py-2 text-center text-[11px] text-foreground-tertiary">
          Preview truncated: showing the start of a large file.
        </p>
      )}
    </div>
  )
}
