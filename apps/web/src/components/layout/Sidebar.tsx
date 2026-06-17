import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { flatNavItems, pinnedNavItems, CHAT_PATH, type NavItem } from '@/app/navigation'
import { SessionList } from '@/features/sessions/SessionList'
import { Wordmark } from './Wordmark'
import { AgentChip } from './AgentChip'

/**
 * Left rail: wordmark, agent presence, a prominent "New chat" action, and the
 * surface NAV — ONE flat, well-ordered list (no section headings), driven
 * entirely by the app/navigation.tsx registry, with Usage + Settings PINNED to
 * the bottom. The list leads with the three primary destinations (Agent Studio ·
 * Chat · Terminal), then the rest (Files · Tasks · Board · System). The rail is
 * NAV-ONLY now: the embedded session list moved out (recents live on Home, the
 * History surface, and ⌘K), so the rail stays quiet and uncluttered.
 *
 * `showSessions` (default FALSE) gates an OPTIONAL embedded session list. The
 * mobile slide-over opts in (its single panel has no dedicated sessions pane
 * beside it, so it carries the list inline); the desktop rail leaves it off.
 */
export function Sidebar({
  onNewChat,
  showSessions = false,
}: {
  onNewChat?: () => void
  showSessions?: boolean
}) {
  // The rail is a single flat list (Studio · Chat · Terminal lead, then Files ·
  // Tasks · Board · System), with Usage + Settings pinned at the bottom. History
  // folded into Chat (its session pane on desktop + the "Past chats" button on
  // mobile), so the rail never lists a History link.
  const items = flatNavItems()
  const pinned = pinnedNavItems()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="px-1 pt-0.5">
        {/* Compact brand: a tight lockup keeps the rail's top quiet so the focus is
            the agent + New chat, not the wordmark. */}
        <Wordmark className="[&_img]:h-6" />
      </div>

      {/* Agent presence — the active agent's face + name, under the brand. */}
      <AgentChip />

      <Button
        variant="outline"
        size="lg"
        onClick={onNewChat}
        // "New chat" is the rail's KEY ACTION → a border-only sky-blue affordance
        // (sky-blue border + glyph, transparent fill) that fills on hover. It stays
        // distinct from the ACTIVE route row, which owns the filled `bg-primary/10`
        // wash + left accent bar, so only one row reads as "selected" at a time.
        // The dark: overrides neutralize the outline variant's own dark fill
        // (`dark:bg-input/30`) so it reads border-only in BOTH themes.
        className="h-9 w-full justify-start gap-2 border-primary/30 bg-transparent text-primary hover:bg-primary/10 hover:text-primary dark:border-primary/30 dark:bg-transparent dark:hover:bg-primary/10 max-sm:h-11"
      >
        <SquarePen className="size-4 text-primary" />
        New chat
      </Button>

      <nav
        aria-label="Main navigation"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
      >
        {/* The flat surface list — ONE well-ordered column, no section headings.
            Studio · Chat · Terminal lead (pinned-top), then Files · Tasks · Board
            · System; Usage + Settings are anchored at the bottom (below). */}
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <RailLink key={item.key} item={item} />
          ))}
        </div>

        {/* In the mobile slide-over (`showSessions`), Settings lives inside the
            same scroll container as the rest of the rail. A separate pinned
            footer can cover the lower rows on short phones. Desktop keeps the
            conventional pinned-bottom treatment below. */}
        {showSessions && pinned.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-3">
            {pinned.map((item) => (
              <RailLink key={item.key} item={item} />
            ))}
          </div>
        )}

        {/* When opted in (the mobile slide-over), the rail carries the session list
            inline below the nav — the slide-over has no dedicated pane beside it.
            §1 — a row click RESUMES the conversation in place (→ /chat?continue=),
            so a past chat is one tap from typing again. */}
        {showSessions && (
          <div className="mt-1 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
            <SessionList
              selectedId={id ?? null}
              onSelect={(sid) => navigate(`${CHAT_PATH}?continue=${encodeURIComponent(sid)}`)}
              onViewTranscript={(sid) => navigate(`/sessions/${sid}`)}
              recentLimit={4}
              // §3 — the mobile embed is the clean, competitor-style dense view.
              dense
            />
          </div>
        )}
      </nav>

      {/* Pinned-bottom surfaces (Settings) — anchored below the grouped nav,
          separated by a hairline, the conventional home for app preferences. */}
      {pinned.length > 0 && !showSessions && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-3">
          {pinned.map((item) => (
            <RailLink key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

/** A single labeled surface nav row (active = sky-blue accent bar + faint sky-blue bg + sky-blue icon). */
function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          // ACTIVE is a sanctioned accent use: the left sky-blue accent BAR (::before)
          // over a FAINT sky-blue-tinted bg (`bg-primary/10`); hover stays a quiet
          // neutral wash (hover is not active). The bar is a 3px inset pseudo so
          // it never shifts the row's content.
          // Rows are a tight ~36px on desktop, relaxing to a 44px touch target on
          // mobile (max-sm:min-h-11), compact without losing thumb reach.
          'relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
          'min-h-9 max-sm:min-h-11 touch-manipulation',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-[2px] before:bg-primary before:opacity-0 before:transition-opacity',
          isActive && 'bg-primary/10 font-medium text-foreground before:opacity-100',
        )
      }
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          <Icon
            className={cn(
              'size-4 shrink-0 transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}
