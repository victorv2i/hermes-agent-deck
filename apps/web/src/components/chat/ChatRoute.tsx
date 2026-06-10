import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { RunAttachment } from '@agent-deck/protocol'
import { ChatView } from '@/components/chat/ChatView'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { LiveRunStateChip } from '@/components/chat/RunStateChip'
import { useChatStore } from '@/state/useChatStore'
import { branchSendPolicy, FORK_COPY } from '@/state/chatStore'
import { useHeaderSlot } from '@/state/headerStore'
import { useModels, useSetModel } from '@/features/models/useModels'
import { useSelectedModel } from '@/features/models/useSelectedModel'
import { useProfiles } from '@/features/profiles/useProfiles'
import { seedDraft, NEW_CHAT_DRAFT_KEY } from '@/features/chat-input/draftStore'
import { StartAgentButton } from '@/features/system/StartAgentButton'
import { fetchHealth, chatHealthKey } from '@/lib/api'
import { useTheme } from '@/components/theme/theme-context'
import { toast } from '@/lib/toast'
import { resolveChatAgent } from './chatIdentity'
import type { ChatOutletContext } from '@/app/navigation'

/**
 * The first-run hand-off Home rides into Chat (HomeRoute.onStartChat): a starter
 * prompt to seed into the composer, and whether to land focus there.
 */
interface ChatHandoffState {
  draft?: string
  focusComposer?: boolean
}

/**
 * The Chat surface — the conversation route mounted at `/`. The live `/chat-run`
 * wiring is owned by the layout (App) and handed down via react-router's Outlet
 * context, so a single socket backs both this surface and the header
 * connection dot. Renders {@link ChatView} and projects the live {@link
 * ChatHeader} (title · model · context ring) into the AppShell top bar.
 * Registered as the Chat entry in the NAV registry (app/navigation.tsx).
 */
export function ChatRoute() {
  const {
    send,
    stop,
    respondApproval,
    retry,
    editTurn,
    connection,
    newChat,
    clearChat,
    activeSessionId,
  } = useOutletContext<ChatOutletContext>()

  // Theme toggle for the composer's `/theme` command (same source the ⌘K palette
  // and the header toggle use), read directly here — it never rides the socket.
  const { toggle: toggleTheme } = useTheme()

  // First-run hand-off from Home: a starter prompt seeds the composer draft and
  // (optionally) lands focus there. We read location.state ONCE — the seed runs
  // in a lazy initializer (during this render, before ChatView/Composer mount)
  // so the composer's draft store picks it up on its very first read; seedDraft
  // refuses to clobber an in-progress draft, so a stale state on back/refresh is
  // harmless. We then clear the history state (replace, state:null) so a later
  // back/refresh can't re-seed a consumed prompt.
  const navigate = useNavigate()
  const location = useLocation()
  const handoff = (location.state ?? null) as ChatHandoffState | null
  // Mount-only snapshot of "should we focus" — captured before we strip state.
  const [autoFocusComposer] = useState(() => handoff?.focusComposer === true)
  useState(() => {
    if (handoff?.draft) seedDraft(NEW_CHAT_DRAFT_KEY, handoff.draft)
    return null
  })
  useEffect(() => {
    if (handoff) navigate(location.pathname + location.search, { replace: true, state: null })
    // Consume the hand-off once on mount; later renders carry the cleared state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const turns = useChatStore((s) => s.turns)
  const runStatus = useChatStore((s) => s.runStatus)
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const error = useChatStore((s) => s.error)
  // Identity carried forward when resuming a session ("Continue") — null for a
  // fresh chat, in which case the header falls back to "New chat" + active model.
  const sessionTitle = useChatStore((s) => s.sessionTitle)
  const sessionModel = useChatStore((s) => s.sessionModel)
  // The active local branch (Lane D) — drives the honest fork banner. Undefined
  // for a plain linear chat (no fork yet) → no banner.
  const activeBranchId = useChatStore((s) => s.activeBranchId)
  const branches = useChatStore((s) => s.branches)
  const forkFromTurnAction = useChatStore((s) => s.forkFromTurn)
  const selectBranchAction = useChatStore((s) => s.selectBranch)

  // The ACTIVE agent's identity (face + friendly name), resolved once for the
  // whole surface (A1) — the same source the chrome's AgentChip + Home use, so a
  // profile shows ONE face everywhere. Threaded into the header, the empty-state
  // greeting, and the per-group assistant avatar. Null while the roster loads or
  // for an unnamed default → chat degrades to its honest anonymous copy.
  const { data: profilesData } = useProfiles()
  const agent = useMemo(() => {
    const profiles = profilesData?.profiles
    if (!profiles || profiles.length === 0) return null
    const activeName = profilesData?.active
    const active =
      profiles.find((p) => p.name === activeName) ??
      profiles.find((p) => p.isDefault) ??
      profiles[0]
    return resolveChatAgent(active)
  }, [profilesData])

  // The gateway's model list (same source as the Models surface). Drives the
  // composer picker; the picker's chosen model rides on every run (T1.2).
  const models = useModels()
  const setModel = useSetModel()
  const modelList = useMemo(() => models.data?.models ?? [], [models.data])
  // Honest chat-readiness. A chat can only run with a usable model on a reachable
  // agent, so the composer must not LOOK ready and then silently fail on send. The
  // gateway-backed models query encodes both failures: a total failure (agent
  // unreachable) → `isError` (the route 502s); a reachable agent with nothing
  // configured → an empty list. Only judge once the query has RESOLVED (no flicker
  // while it loads), and never block when a model is present.
  const blockedReason = useMemo<'unreachable' | 'no-model' | null>(() => {
    if (!models.isError && !models.isSuccess) return null // still loading — don't block
    if (modelList.length > 0) return null
    return models.isError ? 'unreachable' : 'no-model'
  }, [models.isError, models.isSuccess, modelList.length])
  // One-click recovery gating for the unreachable notice. `models.isError` alone
  // cannot tell a down Hermes from a down deck server (both fail the BFF-proxied
  // read). The deck-own `/health` probe can: the request RESOLVING proves the
  // deck server is up, and `hermes.reachable === false` is its honest report
  // that the agent is down. Only that combination offers the Start button; when
  // `/health` itself errors, the restart POST could not land, so the notice
  // keeps its honest no-action copy. Probed only while the chat is blocked.
  const health = useQuery({
    queryKey: chatHealthKey,
    queryFn: fetchHealth,
    enabled: blockedReason === 'unreachable',
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  })
  const canStartAgent =
    blockedReason === 'unreachable' && !health.isError && health.data?.hermes.reachable === false
  // The picker keys + selects by `qualifiedId` (`<provider>/<id>`) — NOT the bare
  // `id`, which collides across providers (e.g. `gpt-5.4` under two providers).
  // So a pick uniquely identifies a (provider, model) pair.
  const availableIds = useMemo(() => modelList.map((m) => m.qualifiedId), [modelList])
  const activeProviderId = models.data?.provider?.id ?? null
  // The active model's qualifiedId is the picker's default (the row stock flagged
  // active); fall back to composing it from the provider + bare active id.
  const activeQualifiedId = useMemo(() => {
    const active = modelList.find((m) => m.active)
    if (active) return active.qualifiedId
    const id = models.data?.activeModelId
    return id && activeProviderId ? `${activeProviderId}/${id}` : (id ?? null)
  }, [modelList, models.data?.activeModelId, activeProviderId])
  // Honest attach gating: stock `/api/model/info` reports the ACTIVE model's
  // vision capability. Only offer image attachments when the agent can actually
  // see them — otherwise the composer disables attach with a tooltip (S5).
  const canAttachImages = models.data?.capabilities?.supportsVision ?? false
  const { selected: selectedQualifiedId, select: selectModel } = useSelectedModel(
    availableIds,
    activeQualifiedId,
  )

  // Resolve the picked qualifiedId back to its ModelEntry (provider + bare id).
  const selectedEntry = useMemo(
    () => modelList.find((m) => m.qualifiedId === selectedQualifiedId) ?? null,
    [modelList, selectedQualifiedId],
  )

  // The model the header labels: a resumed session shows its own model; a fresh
  // chat shows whatever the composer picker has selected (the run target).
  const headerModel = sessionModel ?? selectedEntry?.id ?? selectedQualifiedId

  // Thread the selected model onto every send / retry / edit so each run targets
  // it. A null selection (no models resolved) sends no model — the gateway uses
  // its active model, exactly as before. The run carries the BARE model id (what
  // the gateway expects), never the qualifiedId.
  const modelArg = selectedEntry?.id ?? undefined

  // A pick whose provider differs from the running one is a REAL cross-provider
  // switch: it must hit POST /api/model/set BEFORE the run, or the run silently
  // stays on the old provider (the reported "picking opus did nothing" bug). We
  // await the switch; on a gateway rejection we surface an HONEST toast and the
  // run still proceeds (the gateway falls back to its active model — never a
  // silent wrong-model run masked as success).
  const ensureProviderActive = useCallback(async () => {
    if (!selectedEntry || !activeProviderId) return
    if (selectedEntry.provider === activeProviderId) return
    try {
      await setModel.mutateAsync({ provider: selectedEntry.provider, model: selectedEntry.id })
    } catch (err) {
      toast.error('Couldn’t switch the model', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [selectedEntry, activeProviderId, setModel])

  const handleSend = useCallback(
    (text: string, attachments?: RunAttachment[]) => {
      void ensureProviderActive().then(() => send(text, modelArg, attachments))
    },
    [send, modelArg, ensureProviderActive],
  )
  const handleRetry = useCallback(
    (turnId: string) => {
      void ensureProviderActive().then(() => retry(turnId, modelArg))
    },
    [retry, modelArg, ensureProviderActive],
  )
  const handleEditTurn = useCallback(
    (turnId: string, text: string) => {
      void ensureProviderActive().then(() => editTurn(turnId, text, modelArg))
    },
    [editTurn, modelArg, ensureProviderActive],
  )
  // Refinement row: send a follow-up prompt through the normal run path (honest —
  // it truly re-asks). Uses the current model selection for consistency.
  const handleSendRefinement = useCallback(
    (text: string) => {
      void ensureProviderActive().then(() => send(text, modelArg))
    },
    [send, modelArg, ensureProviderActive],
  )

  // Fork from here (Lane D): create a NEW local branch rooted at a settled turn.
  // Non-destructive — the original continuation stays reachable. The store action
  // swaps the projection to the ancestor path and returns the honest local copy;
  // we then land focus in the composer so the user can type the divergent prompt.
  const handleFork = useCallback(
    (turnId: string) => {
      const copy = forkFromTurnAction(turnId)
      if (copy === null) return
      // Move focus into the composer for the divergent prompt (the fork is local
      // until the user sends it). Done on the next frame so the re-projected
      // transcript has rendered first.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Message your agent"]',
        )
        el?.focus()
      })
    },
    [forkFromTurnAction],
  )

  // The original (pre-fork) branch the user can return to — the non-active branch.
  // Only a LOCAL fork surfaces this; a plain resumed/linear chat has just one
  // branch and no "original" to switch back to.
  const originalBranchId = useMemo(() => {
    if (!branches || !activeBranchId) return null
    const active = branches[activeBranchId]
    if (!active?.localOnly) return null
    return Object.keys(branches).find((id) => id !== activeBranchId) ?? null
  }, [branches, activeBranchId])

  const handleReturnToOriginal = useCallback(() => {
    if (originalBranchId) selectBranchAction(originalBranchId)
  }, [originalBranchId, selectBranchAction])

  // The honest local-fork banner: shown only while a LOCAL fork branch is active.
  // Combines the "original is still saved" line with the send-context line (a
  // historical fork's next message is a NEW chat; a head fork continues honestly).
  const forkBanner = useMemo(() => {
    if (!originalBranchId) return null
    const policy = branchSendPolicy(useChatStore.getState())
    return policy.copy ? `${FORK_COPY.localBanner} ${policy.copy}` : FORK_COPY.localBanner
    // Recompute when the active branch or the turns change (a send may flip the
    // policy from new/unsupported toward same-session continuation).
  }, [originalBranchId, activeBranchId, turns])

  // Context-ring tokens: the most recent assistant turn's total token count —
  // the latest run's input+output, which is the closest honest figure for "what
  // the context now holds" (a SESSION's cumulative counters re-count the whole
  // history every turn, which would wildly overstate fill).
  const contextTokens = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t && t.role === 'assistant' && t.usage) return t.usage.total_tokens
    }
    return 0
  }, [turns])

  // The model's REAL context window (stock `/api/model/info` capabilities, via
  // the same models query above) — unlocks the ring's honest "about N% of memory
  // used" mode. The capabilities describe the gateway's ACTIVE model ONLY, so
  // the limit is supplied just when this conversation targets that model;
  // otherwise the ring keeps its approximate mode rather than dividing by
  // another model's window.
  const contextLimit = useMemo(() => {
    const caps = models.data?.capabilities
    const activeId = models.data?.activeModelId
    if (!caps || !activeId) return undefined
    const limit = caps.effectiveContextLength || caps.contextWindow
    if (!Number.isFinite(limit) || limit <= 0) return undefined
    const target = sessionModel ?? selectedEntry?.id ?? activeId
    return bareModelId(target) === bareModelId(activeId) ? limit : undefined
  }, [models.data, sessionModel, selectedEntry])

  // Project the live header into the shell top bar for as long as Chat is mounted.
  // A NAMED agent rides its face + name into the header; the unnamed default shows
  // no identity name (honest fallback to title-only).
  const header = useMemo(
    () => (
      <ChatHeader
        title={sessionTitle}
        model={headerModel}
        contextTokens={contextTokens}
        contextLimit={contextLimit}
        agentName={agent?.isNamed ? agent.friendlyName : undefined}
        agentAvatarId={agent?.isNamed ? agent.avatarId : undefined}
        // The honest live run-state chip. Self-contained (it subscribes to the
        // chat store and ticks itself), so the header memo only needs the
        // connection it derives offline from.
        statusChip={<LiveRunStateChip connection={connection} />}
      />
    ),
    [sessionTitle, headerModel, contextTokens, contextLimit, agent, connection],
  )
  useHeaderSlot(header)

  // The picker's value is a qualifiedId. A resumed session pins the picker to its
  // own model: resolve the session's bare id to a qualifiedId entry (so the chip
  // still labels it correctly); otherwise the picker follows the live selection.
  const pickerValue = useMemo(() => {
    if (!sessionModel) return selectedQualifiedId
    const entry = modelList.find((m) => m.id === sessionModel || m.qualifiedId === sessionModel)
    return entry?.qualifiedId ?? sessionModel
  }, [sessionModel, selectedQualifiedId, modelList])

  return (
    <ChatView
      turns={turns}
      runStatus={runStatus}
      pendingApproval={pendingApproval}
      error={error}
      // The active agent's identity drives the first-person empty-state greeting
      // and the per-group assistant avatar gutter (A1).
      agent={agent}
      // The composer hosts the real model picker (T1.2); a resumed session pins
      // the picker to its own model so a re-run stays on that model. The picker
      // value + onChange operate in qualifiedId space (unique across providers).
      models={modelList}
      model={pickerValue}
      onModelChange={selectModel}
      contextTokens={contextTokens}
      contextLimit={contextLimit}
      inputDisabled={connection === 'disconnected'}
      // Honest send-gating: surface an actionable notice + disable the composer
      // when the chat genuinely can't run, instead of a live-looking dead send.
      blockedReason={blockedReason}
      onConnectModel={() => navigate('/settings')}
      startAgentAction={canStartAgent ? <StartAgentButton /> : undefined}
      canAttachImages={canAttachImages}
      autoFocusComposer={autoFocusComposer}
      // Key the composer's persisted draft to the active conversation, so each
      // chat keeps its own in-progress draft (a fresh chat maps to the `:new`
      // sentinel) rather than all sharing one.
      sessionId={activeSessionId}
      onSend={handleSend}
      onStop={stop}
      onRetry={handleRetry}
      onEditTurn={handleEditTurn}
      onFork={handleFork}
      forkBanner={forkBanner}
      onReturnToOriginal={originalBranchId ? handleReturnToOriginal : undefined}
      onRespondApproval={respondApproval}
      onSendRefinement={handleSendRefinement}
      // Composer slash-command handlers (mirror the ⌘K palette). `/model` is
      // self-contained (opens the picker); these wire the rest.
      onNewChat={newChat}
      onClearChat={clearChat}
      onToggleTheme={toggleTheme}
    />
  )
}

/** Trim a provider-qualified id (`anthropic/claude-opus-4` → `claude-opus-4`)
 * so a session's bare model id and the picker's qualified id compare honestly. */
function bareModelId(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}
