import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Copy, FileCode, FileJson, FileText, MoreHorizontal, ServerIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { buildExport, exportFilename, triggerDownload, type ExportFormat } from './export'
import { exportSession } from './api'
import { useOrganization, useCreateProject, useSetSessionOrganization } from './organization/hooks'
import { allTags, sessionProjectId, sessionTags } from './organization/organizationFilter'
import { SessionOrganizeMenu } from './organization/SessionOrganizeMenu'
import type { SessionDetail, SessionMessage } from './types'

/**
 * The session overflow control (T2.4 / #115). A quiet icon trigger → popover
 * holding the session's no-backend actions: copy the session id, or export the
 * transcript as a self-contained HTML file (the shareable "here's what my agent
 * did" artifact), readable Markdown, or faithful JSON. Export serializes the
 * already-loaded `GET /sessions/:id/messages` payload client-side and downloads
 * a Blob — a LOCAL file, no upload, no share-link; copy reads the id that's
 * already in hand. Each confirms via a calm toast (the app's bottom feedback
 * channel). The action accent is governed, so the trigger is a muted ghost control, never a
 * sky-blue fill.
 *
 * The menu stays reachable whenever a session is open: copying the id works on
 * an empty transcript, so the export items are gated individually rather than
 * disabling the whole trigger.
 */
export function TranscriptExportMenu({
  detail,
  messages,
}: {
  detail: SessionDetail | null
  messages: SessionMessage[]
}) {
  const [open, setOpen] = useState(false)

  // Agentdeck's own project/tag store, so the History menu can move the open
  // session into a project or edit its tags (alongside Copy ID / Export).
  const orgQuery = useOrganization()
  const org = orgQuery.data
  const createProject = useCreateProject()
  const setSessionOrg = useSetSessionOrganization()

  function handleExport(format: ExportFormat) {
    setOpen(false)
    const { body, mime } = buildExport(detail, messages, format)
    const filename = exportFilename(detail, format)
    triggerDownload(filename, body, mime)
    toast.success('Transcript exported', { description: filename })
  }

  async function handleCopyId() {
    setOpen(false)
    if (!detail) return
    try {
      await navigator.clipboard?.writeText(detail.id)
      toast.success('Session ID copied')
    } catch {
      toast.error("Couldn't copy the session ID")
    }
  }

  /**
   * Download the full session export JSON from Hermes (GET /api/sessions/{id}/export).
   * This is the authoritative Hermes-side dump (may have more detail than the
   * loaded client-side transcript). Distinct from the client-side export which
   * only serializes the already-loaded messages.
   */
  async function handleHermesExport() {
    setOpen(false)
    if (!detail) return
    try {
      const payload = await exportSession(detail.id)
      const json = JSON.stringify(payload, null, 2)
      const filename = `session-${detail.id.slice(0, 8)}-hermes.json`
      triggerDownload(filename, json, 'application/json')
      toast.success('Hermes session exported', { description: filename })
    } catch {
      toast.error('Export failed', { description: "Couldn't fetch the session from Hermes." })
    }
  }

  const hasContent = messages.length > 0

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Session actions"
          disabled={!detail}
          title="Session actions"
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2/60 text-muted-foreground transition-colors',
            'hover:border-border-strong hover:text-foreground',
            'focus-visible:ad-focus',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={8}
          className="ad-surface z-50 w-48 rounded-xl bg-popover p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="Session actions" className="flex flex-col gap-0.5">
            <MenuItem icon={Copy} label="Copy session ID" onSelect={handleCopyId} />
            <MenuItem
              icon={ServerIcon}
              label="Download from Hermes"
              disabled={!detail}
              title={detail ? 'Full session JSON from Hermes (authoritative)' : 'No session loaded'}
              onSelect={handleHermesExport}
            />
            <div className="my-0.5 h-px bg-border" role="separator" />
            <MenuItem
              icon={FileCode}
              label="Export as HTML"
              disabled={!hasContent}
              title={
                hasContent ? 'A self-contained file you can open or keep' : 'No messages to export'
              }
              onSelect={() => handleExport('html')}
            />
            <MenuItem
              icon={FileText}
              label="Export as Markdown"
              disabled={!hasContent}
              title={hasContent ? undefined : 'No messages to export'}
              onSelect={() => handleExport('md')}
            />
            <MenuItem
              icon={FileJson}
              label="Export as JSON"
              disabled={!hasContent}
              title={hasContent ? undefined : 'No messages to export'}
              onSelect={() => handleExport('json')}
            />
            {/* Organize (project + tags) — wired once the org store loads. */}
            {detail && org && (
              <>
                <div className="my-0.5 h-px bg-border" role="separator" />
                <SessionOrganizeMenu
                  sessionId={detail.id}
                  projectId={sessionProjectId(org, detail.id)}
                  tags={sessionTags(org, detail.id)}
                  projects={org.projects}
                  tagSuggestions={allTags(org)}
                  onSetOrganization={(input) => setSessionOrg.mutate({ id: detail.id, input })}
                  onCreateProject={(input) => createProject.mutateAsync(input)}
                  onClose={() => setOpen(false)}
                />
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  disabled = false,
  title,
}: {
  icon: typeof FileText
  label: string
  onSelect: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      <Icon className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
