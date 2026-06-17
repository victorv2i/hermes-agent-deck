import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import type { AvatarId } from '@agent-deck/protocol'
import { Avatar } from '@/components/ui/avatar'
import { ContextRing } from './ContextRing'

/**
 * The live chat header projected into the AppShell top bar (design language §4:
 * "minimal sticky header — session title · model · context-usage ring").
 *
 * It carries identity that the chat surface owns: the active agent's FACE + name
 * (so chat is no longer an anonymous text stream — A1), the session title (or
 * "New chat" for a fresh conversation), the active model, and the honest context
 * ring. On "Continue", the resumed session's title/model are threaded through so
 * resuming never drops you into an empty, identity-less header (T1.3).
 *
 * The action accent is governed (action/active only): the model reads as a quiet muted label
 * and the agent face is IDENTITY, never the sky-blue accent (the Avatar primitive
 * enforces the `--border-strong` ring + neutral fallback).
 */
export function ChatHeader({
  title,
  model,
  contextTokens,
  contextLimit,
  agentName,
  agentAvatarId,
}: {
  /** Session title, or null for a new chat (rendered as "New chat"). */
  title: string | null
  /** Active/resumed model id, or null when unresolved. */
  model: string | null
  /** Tokens consumed so far, for the context ring. */
  contextTokens: number
  /** The model's real context window, when known. */
  contextLimit?: number
  /** The active agent's friendly name — shown BEFORE the title. Undefined for the
   * unnamed default agent (the header then falls back to title-only). */
  agentName?: string
  /** The active agent's resolved avatar id — the face beside the name. */
  agentAvatarId?: AvatarId
}) {
  const shown = title?.trim() || 'New chat'
  const hasAgent = !!agentName && !!agentAvatarId
  return (
    <div data-testid="chat-header" className="flex min-w-0 items-center gap-2.5">
      {hasAgent && (
        <span data-testid="chat-header-identity" className="flex shrink-0 items-center gap-2">
          <span data-testid="chat-header-avatar" className="shrink-0">
            <Avatar avatarId={agentAvatarId} name={agentName} size={24} />
          </span>
          <span
            data-testid="chat-header-agent-name"
            className="max-w-[14ch] truncate text-sm font-medium text-foreground sm:max-w-[22ch]"
            title={agentName}
          >
            {agentName}
          </span>
          {/* A quiet separator between the agent identity and the session title. */}
          <span aria-hidden className="text-foreground-tertiary">
            ·
          </span>
        </span>
      )}
      <span
        className={
          hasAgent
            ? // With the agent identity leading, the session title steps back to a
              // quieter secondary so the face + name read as the primary anchor.
              'min-w-0 truncate text-sm text-muted-foreground'
            : 'min-w-0 truncate text-sm font-medium text-foreground'
        }
        title={shown}
      >
        {shown}
      </span>
      {model && (
        // Which model is answering is exactly what a newcomer needs on a phone,
        // so the chip is visible at every width (it was `hidden sm:inline-flex`).
        // It shrinks and truncates the model name on narrow screens — the session
        // title yields width first — so the chip never pushes the row to wrap.
        <span
          data-testid="chat-header-model"
          className="inline-flex max-w-[10ch] shrink-0 items-center truncate rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:max-w-none"
          title={model}
        >
          {shortModel(model)}
        </span>
      )}
      <ContextRing tokens={contextTokens} limit={contextLimit} className="shrink-0" />

      {/* "Past chats" — the MOBILE way into History. On desktop (>=lg, 1024px) the
          chat surface's session pane already lists past chats, so this hides
          there (`lg:hidden`); below it the pane isn't shown, so this icon button
          is the way in. A >=40px touch target with an explicit accessible name
          (the glyph is decorative). */}
      <Link
        to="/history"
        aria-label="Past chats"
        title="Past chats"
        className="ml-auto inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        data-testid="chat-header-past-chats"
      >
        <History className="size-4" aria-hidden />
      </Link>
    </div>
  )
}

/** Trim a provider-qualified id (`anthropic/claude-opus-4` → `claude-opus-4`). */
function shortModel(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}
