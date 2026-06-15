/**
 * AgentMemoryTabs — a single agent's "inner life": SOUL, MEMORY, USER — all
 * EDITABLE. LIFTED from the standalone `/memory` surface (MemorySoulRoute), but
 * SCOPED to one profile (no profile picker) so it reads as part of THIS agent's
 * character sheet inside the Agents hub.
 *
 *   SOUL   → ${profile_dir}/SOUL.md            (your file — safe to edit)
 *   MEMORY → ${profile_dir}/memories/MEMORY.md (agent-managed — editable, with a note)
 *   USER   → ${profile_dir}/memories/USER.md   (your file — safe to edit)
 *
 * Each file edits in place (CodeMirror, lazily loaded). The honest boundary line
 * is preserved verbatim: this edits the files but does NOT stop the agent
 * forgetting and does NOT control what the agent reads — that is the runtime
 * memory provider, which can rewrite MEMORY.md.
 *
 * `onDirtyChange` surfaces unsaved-edit state so the parent route can guard a
 * navigation away from a half-written file.
 */
import { lazy, Suspense, useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil, Save, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CodeView } from '@/features/files/CodeView'
import { memoryKeys, useProfileFile, useWriteProfileFile } from '@/features/memory/hooks'
import type { ProfileFileKind } from '@/features/memory/api'
import { fetchMemoryProvider, resetMemory, setMemoryProvider } from '@/features/system/memoryApi'
import { AgentSkillsSection } from './AgentSkillsSection'
import { MemoryProviderSection } from './MemoryProviderSection'
import { resolveHubTab, type HubTabId } from './hubTabs'

const CodeEditor = lazy(() => import('@/features/files/CodeEditor'))
const MEMORY_PROVIDER_QUERY_KEY = ['memory-provider'] as const

/**
 * Expands a compact (`size="sm"`, 28px-tall) header button's CLICKABLE area to a
 * >=40px tap target without enlarging its visual box — a transparent `before:`
 * pseudo-element overlay pads 6px above/below (28 + 12 = 40px). Keeps the dense
 * character-sheet header tidy while staying touch-reachable (WCAG 2.5.8).
 */
const HIT_AREA = "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"

/**
 * The hub's tabs: the three editable files, memory-provider controls, plus the
 * folded-in Skills browser. `skills`/`provider` are not file kinds — they render
 * their own panel instead of the file editor, so they carry no file header/note.
 * The id set lives in {@link HubTabId} (`hubTabs.ts`), shared with the `?tab=`
 * resolver so a refresh lands back on the same tab.
 */

interface TabDef {
  kind: ProfileFileKind
  label: string
  filename: string
  note: string
}

// All three files are EDITABLE (symmetric writes). MEMORY carries an honest note
// that the runtime memory provider may rewrite it; the verbatim boundary panel
// below restates this for every tab.
const TABS: TabDef[] = [
  {
    kind: 'soul',
    label: 'Soul',
    filename: 'SOUL.md',
    note: 'Your file. Safe to edit.',
  },
  {
    kind: 'memory',
    label: 'Memory',
    filename: 'MEMORY.md',
    note: 'Agent-managed: you can edit it, but the agent may rewrite it.',
  },
  {
    kind: 'user',
    label: 'User',
    filename: 'USER.md',
    note: 'Your file. Safe to edit.',
  },
]

/** The tab strip: the three file tabs plus Provider and folded-in Skills tabs. */
const HUB_TABS: { kind: HubTabId; label: string }[] = [
  ...TABS.map((t) => ({ kind: t.kind as HubTabId, label: t.label })),
  { kind: 'provider', label: 'Provider' },
  { kind: 'skills', label: 'Skills' },
]

export function AgentMemoryTabs({
  profile,
  isActive,
  onDirtyChange,
}: {
  profile: string
  /** Whether THIS agent is the active profile — drives the Skills toggle scope. */
  isActive: boolean
  onDirtyChange?: (dirty: boolean) => void
}) {
  // The active tab is driven by `?tab=` (mirroring Connections), so a refresh or a
  // shared/deep link lands back on the same tab instead of resetting to Soul.
  const [params, setParams] = useSearchParams()
  const tab = resolveHubTab(params.get('tab'))
  const tabBaseId = useId()
  const tabId = (kind: HubTabId) => `${tabBaseId}-tab-${kind}`
  const panelId = (kind: HubTabId) => `${tabBaseId}-panel-${kind}`
  const onSkills = tab === 'skills'
  const onProvider = tab === 'provider'
  const onFile = !onSkills && !onProvider

  // A pending tab switch held back while a file draft is unsaved (fix: a tab
  // click used to silently drop the draft). null = nothing pending.
  const [pendingTab, setPendingTab] = useState<HubTabId | null>(null)

  // Commit a tab switch = rewrite `?tab=` (replace, so the tab strip doesn't
  // pollute Back). The dirty guard is applied by the `selectTab` wrapper below.
  const commitTab = useCallback(
    (id: HubTabId) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', id)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // On the Provider/Skills tabs there is no file; default the file machinery to 'soul' but
  // disable the fetch so we never load a file the user isn't looking at.
  const fileKind: ProfileFileKind = onFile ? tab : 'soul'
  const tabDef = TABS.find((t) => t.kind === fileKind)!

  const file = useProfileFile(onFile ? profile : null, fileKind)
  const writeFile = useWriteProfileFile(profile, fileKind)
  const queryClient = useQueryClient()

  const [switchResult, setSwitchResult] = useState<Awaited<
    ReturnType<typeof setMemoryProvider>
  > | null>(null)
  const memoryProvider = useQuery({
    queryKey: MEMORY_PROVIDER_QUERY_KEY,
    queryFn: ({ signal }) => fetchMemoryProvider(signal),
    enabled: onProvider,
    staleTime: 5_000,
  })
  const switchProvider = useMutation({
    mutationFn: setMemoryProvider,
    onSuccess: async (result) => {
      setSwitchResult(result)
      await queryClient.invalidateQueries({ queryKey: MEMORY_PROVIDER_QUERY_KEY })
    },
  })
  const resetBuiltInMemory = useMutation({
    mutationFn: resetMemory,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMORY_PROVIDER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: memoryKeys.file(profile, 'memory') }),
        queryClient.invalidateQueries({ queryKey: memoryKeys.file(profile, 'user') }),
      ])
    },
  })

  // Edit state. A new tab/profile resets editing via the adjust-state-during-
  // render pattern (no effect → no cascading render), mirroring the source surface.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const fileKey = `${profile} ${tab}`
  const [lastFileKey, setLastFileKey] = useState(fileKey)
  if (fileKey !== lastFileKey) {
    setLastFileKey(fileKey)
    setEditing(false)
    setJustSaved(false)
  }

  const content = file.data?.content ?? ''
  const dirty = onFile && editing && draft !== content

  // Surface unsaved-edit state to the parent (route-change guard).
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  // Switch tabs, but never silently drop an unsaved file draft: while dirty, hold
  // the requested tab and ask through the themed ConfirmDialog (matching the
  // app's other guarded actions). Same-tab clicks are a no-op.
  const selectTab = useCallback(
    (id: HubTabId) => {
      if (id === tab) return
      if (dirty) {
        setPendingTab(id)
        return
      }
      commitTab(id)
    },
    [tab, dirty, commitTab],
  )

  // Confirm leaving the dirty draft → discard the edit and complete the pending
  // switch. Cancel → stay on the current tab with the draft intact.
  const confirmLeave = () => {
    const dest = pendingTab
    setPendingTab(null)
    if (dest) {
      setEditing(false)
      commitTab(dest)
    }
  }
  const cancelLeave = () => setPendingTab(null)

  // Roving arrow-key nav across the tab strip (a real tablist): Left/Right move
  // + activate, Home/End jump to the ends — mirroring the Connections/Terminal
  // tab pattern so keyboard users get the same parity everywhere. Routed through
  // `selectTab` so the dirty guard applies to keyboard switches too.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const kinds = HUB_TABS.map((t) => t.kind)
    const i = kinds.indexOf(tab)
    if (i === -1) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % kinds.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + kinds.length) % kinds.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = kinds.length - 1
    if (next === null) return
    e.preventDefault()
    const nextKind = kinds[next]!
    selectTab(nextKind)
    // Focus follows selection (WAI-ARIA tabs): move DOM focus to the newly
    // selected tab so keyboard users land on it, not the now-untabbable old one.
    // (When the guard intercepts, the dialog takes focus instead.)
    if (!dirty) {
      e.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(nextKind))}`)?.focus()
    }
  }

  const beginEditing = () => {
    setDraft(content)
    setEditing(true)
  }
  const saveError = writeFile.isError
    ? writeFile.error instanceof Error
      ? writeFile.error.message
      : 'Save failed'
    : null
  const providerError = memoryProvider.isError
    ? memoryProvider.error instanceof Error
      ? memoryProvider.error.message
      : 'Could not load memory status.'
    : switchProvider.isError
      ? switchProvider.error instanceof Error
        ? switchProvider.error.message
        : 'Could not switch memory provider.'
      : resetBuiltInMemory.isError
        ? resetBuiltInMemory.error instanceof Error
          ? resetBuiltInMemory.error.message
          : 'Could not reset built-in memory.'
        : null

  const handleSave = async () => {
    await writeFile.mutateAsync(draft)
    setJustSaved(true)
    setEditing(false)
    window.setTimeout(() => setJustSaved(false), 1800)
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Tabs: SOUL | MEMORY | USER | PROVIDER | SKILLS */}
      <div className="px-1 py-2">
        <div
          role="tablist"
          aria-label="Agent files & skills"
          aria-orientation="horizontal"
          onKeyDown={onTabKeyDown}
          // Mobile (~375px): a 5-up grid so all five short labels fit the row
          // without horizontal overflow; >=sm it relaxes to the natural inline
          // strip. Mirrors the Connections tab strip's responsive pattern.
          className="ad-surface grid w-full grid-cols-5 rounded-md bg-surface-1 p-1 sm:inline-flex sm:w-auto"
        >
          {HUB_TABS.map((t) => {
            const selected = t.kind === tab
            return (
              <button
                key={t.kind}
                type="button"
                role="tab"
                id={tabId(t.kind)}
                aria-selected={selected}
                aria-controls={panelId(t.kind)}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(t.kind)}
                className={cn(
                  // min-h-11 keeps the tap target >=44px (WCAG 2.5.8) on phones;
                  // truncate guards the longest label inside a narrow column.
                  'inline-flex min-h-11 min-w-0 items-center justify-center rounded-[7px] px-1.5 py-1.5 text-13 font-medium transition-colors sm:min-h-0 sm:px-3.5',
                  'focus-visible:ad-focus',
                  selected
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="min-w-0 truncate">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {onProvider ? (
        <div
          role="tabpanel"
          id={panelId('provider')}
          aria-labelledby={tabId('provider')}
          className="pt-1"
        >
          <MemoryProviderSection
            isActiveAgent={isActive}
            memoryStatus={memoryProvider.data ?? null}
            isLoading={memoryProvider.isLoading}
            error={providerError}
            isSwitching={switchProvider.isPending}
            isResetting={resetBuiltInMemory.isPending}
            switchResult={switchResult}
            onSwitchProvider={(providerName) => {
              if (isActive) switchProvider.mutate(providerName)
            }}
            onResetMemory={(target) => {
              if (isActive) resetBuiltInMemory.mutate(target)
            }}
          />
        </div>
      ) : onSkills ? (
        <div
          role="tabpanel"
          id={panelId('skills')}
          aria-labelledby={tabId('skills')}
          className="pt-1"
        >
          <AgentSkillsSection isActive={isActive} />
        </div>
      ) : (
        <FilePanel
          panelId={panelId(tab)}
          tabLabelId={tabId(tab)}
          tabDef={tabDef}
          file={file}
          editing={editing}
          draft={draft}
          dirty={dirty}
          justSaved={justSaved}
          saveError={saveError}
          isSaving={writeFile.isPending}
          onBeginEdit={beginEditing}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
          onDraftChange={setDraft}
        />
      )}

      {/* Unsaved-draft guard on a TAB switch (same intent as the route-leave
          guard one level up): the themed ConfirmDialog, not a silent drop. */}
      <Dialog
        open={pendingTab !== null}
        onOpenChange={(open) => {
          // Closing the dialog by any means (Esc, overlay, the X) means "stay".
          if (!open) cancelLeave()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Switch tabs with unsaved changes?</DialogTitle>
            <DialogDescription>
              You’ve edited {tabDef.filename} but haven’t saved. If you switch tabs now, those
              changes are lost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={cancelLeave}>
              Stay
            </Button>
            <Button variant="destructive" onClick={confirmLeave}>
              Discard changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The Soul/Memory/User file panel: header (name pill · note · Edit/Save) + body. */
function FilePanel({
  panelId,
  tabLabelId,
  tabDef,
  file,
  editing,
  draft,
  dirty,
  justSaved,
  saveError,
  isSaving,
  onBeginEdit,
  onCancel,
  onSave,
  onDraftChange,
}: {
  panelId: string
  tabLabelId: string
  tabDef: TabDef
  file: ReturnType<typeof useProfileFile>
  editing: boolean
  draft: string
  dirty: boolean
  justSaved: boolean
  saveError: string | null
  isSaving: boolean
  onBeginEdit: () => void
  onCancel: () => void
  onSave: () => void
  onDraftChange: (v: string) => void
}) {
  const content = file.data?.content ?? ''
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabLabelId}
      className="flex min-h-0 flex-col"
    >
      {/* File header: name pill · honest note · Edit/Save actions */}
      <div className="flex items-center gap-2.5 border-b border-border px-1 py-3">
        <Badge variant="muted" className="shrink-0 font-mono lowercase">
          {tabDef.filename}
        </Badge>
        <span className="min-w-0 truncate text-xs text-foreground-tertiary">{tabDef.note}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {justSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" /> Saved
            </span>
          )}
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBeginEdit}
              disabled={file.isLoading}
              className={HIT_AREA}
            >
              <Pencil />
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={isSaving}
                className={HIT_AREA}
              >
                <X />
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={!dirty || isSaving} className={HIT_AREA}>
                {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <p className="border-b border-border bg-destructive/5 px-1 py-2 text-xs text-destructive">
          {saveError}
        </p>
      )}

      {/* Honest boundary panel (verbatim per the surface contract). */}
      <div
        data-testid="agent-memory-boundary"
        role="note"
        className="border-b border-border bg-surface-1/40 px-1 py-2.5 text-xs leading-relaxed text-foreground-tertiary"
      >
        This surfaces and edits the memory files, but it does not stop the agent forgetting (that is
        the runtime memory provider) and does not control what the agent reads. To debug forgetting,
        check Logs.
      </div>

      {/* Body: the active file, read (CodeView) or edit (CodeEditor). */}
      <div className="max-h-[460px] min-h-[180px] flex-1 overflow-auto rounded-b-lg">
        {file.isLoading ? (
          <div className="space-y-2.5 px-1 py-5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted/50"
                style={{ width: `${90 - i * 8}%` }}
              />
            ))}
          </div>
        ) : file.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-sm text-foreground-tertiary">
              {file.error instanceof Error ? file.error.message : "Couldn't load this file."}
            </p>
          </div>
        ) : !file.data?.exists && !editing ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="max-w-sm text-sm text-foreground-tertiary">
              No {tabDef.filename} yet for this agent. Click Edit to create one.
            </p>
          </div>
        ) : editing ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-10 text-foreground-tertiary">
                <Loader2 className="size-5 animate-spin" />
              </div>
            }
          >
            <CodeEditor value={draft} onChange={onDraftChange} filename={tabDef.filename} />
          </Suspense>
        ) : (
          <CodeView code={content} lang="markdown" />
        )}
      </div>
    </div>
  )
}
