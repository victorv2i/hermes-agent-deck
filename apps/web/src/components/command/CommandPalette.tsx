import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  Check,
  Blocks,
  Moon,
  MessagesSquare,
  Palette as PaletteIcon,
  Package,
  RefreshCw,
  Send,
  AudioLines,
  ScrollText,
  ShieldCheck,
  SquarePen,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import {
  NAV,
  NAV_GROUPS,
  NAV_GROUP_LABEL_KEYS,
  type NavGroup,
  type NavItemLabelKey,
} from '@/app/navigation'
import { useTranslation } from '@/i18n'
import { useSessions } from '@/features/sessions/hooks'
import { useRestartGateway, useCheckSystem } from '@/features/system/useSystem'
import { useTheme } from '@/components/theme/theme-context'
import type { ResolvedTheme } from '@/components/theme/theme-context'
import { usePalette } from '@/features/themes/palette'
import { PALETTES } from '@/features/themes/palette-registry'
import type { Palette } from '@/features/themes/palette'
import type { SessionSummary } from '@/features/sessions/types'
import { sanitizeSessionPreview } from '@/features/sessions/sessionPreview'
import { Avatar } from '@/components/ui/avatar'
import { useProfiles } from '@/features/profiles/useProfiles'
import { useSwitchProfile, switchAppliedLine } from '@/features/profiles/mutations'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import type { ProfileSummary } from '@/features/profiles/types'
import { toast } from '@/lib/toast'
import { usePlatformModKey } from './platformMod'

/**
 * The ⌘K command palette — jump to any surface, search & open a session, start a
 * New chat, or toggle the theme. Presentational ({@link CommandPaletteView})
 * takes its data + actions as props so it's hermetically testable; the connected
 * {@link CommandPalette} wires the NAV registry, the live session list, the
 * router, and the theme. Per the design language this is the keyboard heart of
 * the app: calm, fast, with a faint amber-tinted active row (active/highlight is
 * a sanctioned amber use) and amber "active" check markers.
 */

export interface PaletteNavItem {
  key: string
  label: string
  labelKey: NavItemLabelKey
  group: NavGroup
  /** The surface's real Lucide icon (from the NAV registry), so each row reads
   * as itself — not a generic chat glyph. */
  icon: LucideIcon
  run: () => void
}

// The palette groups its surface rows exactly like the rail — driven by the same
// registry order + friendly labels, so the two never drift.
const GROUP_ORDER: readonly NavGroup[] = NAV_GROUPS

function CommandRowLabel({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">{children}</span>
      {detail ? (
        <span className="block truncate text-xs text-foreground-tertiary">{detail}</span>
      ) : null}
    </span>
  )
}

export interface CommandPaletteViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  navItems: PaletteNavItem[]
  sessions: SessionSummary[]
  sessionsLoading: boolean
  onOpenSession: (id: string) => void
  onNewChat: () => void
  onToggleTheme: () => void
  resolvedTheme: ResolvedTheme
  /** The active color-scheme palette, so its row reads as selected. */
  activePalette: Palette
  /** Switch the color-scheme palette (quick-switch from the palette). */
  onSetPalette: (palette: Palette) => void
  /** Clear the current conversation. Omitted → the action isn't offered. */
  onClearChat?: () => void
  /**
   * Restart the gateway (the Maintenance dock's always-safe action). Omitted →
   * the action isn't offered. The real confirm/honest-cost copy lives on the
   * System surface; from the palette this kicks the same real restart mutation.
   */
  onRestartGateway?: () => void
  /** Re-check Hermes update availability (re-reads the dock). Omitted → not offered. */
  onCheckHermesUpdates?: () => void
  /** Navigate to the System maintenance surface (also a rail row + auto Go-to
   * row; this explicit action keeps "maintenance" searches landing there). Omitted → not offered. */
  onOpenSystem?: () => void
  /** Navigate to the raw Logs surface (demoted from the rail). Omitted → not offered. */
  onOpenLogs?: () => void
  /** Open Connections → Messaging tab (connect Telegram/Discord/Slack/…). Omitted → not offered. */
  onOpenMessaging?: () => void
  /** Open Connections → MCP tab (tools your agent can call). Omitted → not offered. */
  onOpenMcp?: () => void
  /** Open Connections → Voice tab (TTS/STT providers + voice notes). Omitted → not offered. */
  onOpenVoice?: () => void
  /** The agent roster — switch the active agent by keyboard. */
  agents: ProfileSummary[]
  /** The name of the active agent (its row reads as selected). */
  activeAgent: string
  /** Switch the active agent (shared `switchProfile`; honest restart caveat). */
  onSwitchAgent: (name: string) => void
}

export function CommandPaletteView({
  open,
  onOpenChange,
  navItems,
  sessions,
  sessionsLoading,
  onOpenSession,
  onNewChat,
  onToggleTheme,
  resolvedTheme,
  activePalette,
  onSetPalette,
  onClearChat,
  onRestartGateway,
  onCheckHermesUpdates,
  onOpenSystem,
  onOpenLogs,
  onOpenMessaging,
  onOpenMcp,
  onOpenVoice,
  agents,
  activeAgent,
  onSwitchAgent,
}: CommandPaletteViewProps) {
  const { t } = useTranslation()

  // Run an action then dismiss the palette.
  const act = (fn: () => void) => () => {
    fn()
    onOpenChange(false)
  }

  // The modifier accelerator (⌘ on Mac, Ctrl elsewhere) — the SAME shared source
  // the `?` shortcuts overlay reads, so the palette never shows a Mac-only ⌘ to a
  // Linux user who must actually press Ctrl.
  const mod = usePlatformModKey()

  const goingToLight = resolvedTheme === 'dark'
  const actionLabels = {
    newChat: t('commandPalette.action.newChat'),
    clearChat: t('commandPalette.action.clearChat'),
    messaging: t('commandPalette.action.messaging'),
    mcp: t('commandPalette.action.mcp'),
    voice: t('commandPalette.action.voice'),
    restartGateway: t('commandPalette.action.restartGateway'),
    checkHermesUpdates: t('commandPalette.action.checkHermesUpdates'),
    openSystem: t('commandPalette.action.openSystem'),
    openLogs: t('commandPalette.action.openLogs'),
  }
  const sessionLabels = {
    loading: t('commandPalette.session.loading'),
    untitled: t('commandPalette.session.untitled'),
    empty: t('commandPalette.session.empty'),
  }
  const themeToggleLabel = goingToLight
    ? t('commandPalette.action.switchToLightTheme')
    : t('commandPalette.action.switchToDarkTheme')

  const groupedNav = GROUP_ORDER.map((group) => ({
    group,
    items: navItems.filter((n) => n.group === group),
  })).filter((g) => g.items.length > 0)

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t('commandPalette.dialog.label')}>
      <CommandInput
        placeholder={t('commandPalette.search.placeholder')}
        aria-label={t('commandPalette.dialog.label')}
      />
      <CommandList>
        <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>

        <CommandGroup heading={t('commandPalette.group.actions')}>
          <CommandItem
            value={actionLabels.newChat}
            keywords={[actionLabels.newChat, 'create', 'start']}
            onSelect={act(onNewChat)}
          >
            <SquarePen />
            <CommandRowLabel>{actionLabels.newChat}</CommandRowLabel>
            <CommandShortcut>{mod}N</CommandShortcut>
          </CommandItem>
          {onClearChat && (
            <CommandItem
              value={actionLabels.clearChat}
              keywords={[actionLabels.clearChat, 'reset', 'empty', 'clear']}
              onSelect={act(onClearChat)}
            >
              <Trash2 />
              <CommandRowLabel>{actionLabels.clearChat}</CommandRowLabel>
            </CommandItem>
          )}
          <CommandItem
            value={themeToggleLabel}
            keywords={['appearance', 'dark', 'light', 'mode']}
            onSelect={act(onToggleTheme)}
          >
            {goingToLight ? <Sun /> : <Moon />}
            <CommandRowLabel>{themeToggleLabel}</CommandRowLabel>
          </CommandItem>
          {onOpenMessaging && (
            <CommandItem
              value={actionLabels.messaging}
              keywords={[
                actionLabels.messaging,
                'messaging',
                'connect',
                'telegram',
                'discord',
                'slack',
                'whatsapp',
                'signal',
                'bot',
                'platform',
              ]}
              onSelect={act(onOpenMessaging)}
            >
              <Send />
              <CommandRowLabel>{actionLabels.messaging}</CommandRowLabel>
            </CommandItem>
          )}
          {onOpenMcp && (
            <CommandItem
              value={actionLabels.mcp}
              keywords={[
                actionLabels.mcp,
                'mcp',
                'servers',
                'tools',
                'model context protocol',
                'server',
                'catalog',
                'context7',
              ]}
              onSelect={act(onOpenMcp)}
            >
              <Blocks />
              <CommandRowLabel>{actionLabels.mcp}</CommandRowLabel>
            </CommandItem>
          )}
          {onOpenVoice && (
            <CommandItem
              value={actionLabels.voice}
              keywords={[
                actionLabels.voice,
                'voice',
                'tts',
                'stt',
                'speech',
                'audio',
                'speak',
                'elevenlabs',
                'whisper',
                'transcribe',
              ]}
              onSelect={act(onOpenVoice)}
            >
              <AudioLines />
              <CommandRowLabel>{actionLabels.voice}</CommandRowLabel>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandGroup heading={t('commandPalette.group.appearance')}>
          {PALETTES.map((p) => {
            const active = p.id === activePalette
            return (
              <CommandItem
                key={p.id}
                value={t('commandPalette.action.setThemeTo', { theme: p.label })}
                keywords={['palette', 'theme', 'color', 'scheme', 'appearance', p.label]}
                onSelect={act(() => onSetPalette(p.id))}
                aria-current={active ? 'true' : undefined}
              >
                <PaletteIcon />
                <CommandRowLabel detail={p.description}>
                  {t('commandPalette.action.setThemeTo', { theme: p.label })}
                </CommandRowLabel>
                {active && (
                  <Check
                    className="text-primary"
                    aria-label={t('commandPalette.status.activeTheme')}
                  />
                )}
              </CommandItem>
            )
          })}
        </CommandGroup>

        {(onRestartGateway || onCheckHermesUpdates || onOpenSystem || onOpenLogs) && (
          <CommandGroup heading={t('commandPalette.group.maintenanceAndLogs')}>
            {onRestartGateway && (
              <CommandItem
                value={actionLabels.restartGateway}
                keywords={[
                  actionLabels.restartGateway,
                  'gateway',
                  'restart',
                  'reconnect',
                  'maintenance',
                ]}
                onSelect={act(onRestartGateway)}
              >
                <RefreshCw />
                <CommandRowLabel>{actionLabels.restartGateway}</CommandRowLabel>
              </CommandItem>
            )}
            {onCheckHermesUpdates && (
              <CommandItem
                value={actionLabels.checkHermesUpdates}
                keywords={[
                  actionLabels.checkHermesUpdates,
                  'hermes',
                  'update',
                  'upgrade',
                  'check',
                  'maintenance',
                ]}
                onSelect={act(onCheckHermesUpdates)}
              >
                <Package />
                <CommandRowLabel>{actionLabels.checkHermesUpdates}</CommandRowLabel>
              </CommandItem>
            )}
            {onOpenSystem && (
              <CommandItem
                value={actionLabels.openSystem}
                keywords={[
                  actionLabels.openSystem,
                  'system',
                  'maintenance',
                  'gateway',
                  'update',
                  'dock',
                ]}
                onSelect={act(onOpenSystem)}
              >
                <ShieldCheck />
                <CommandRowLabel>{actionLabels.openSystem}</CommandRowLabel>
              </CommandItem>
            )}
            {onOpenLogs && (
              <CommandItem
                value={actionLabels.openLogs}
                keywords={[
                  actionLabels.openLogs,
                  'logs',
                  'raw logs',
                  'debug',
                  'maintenance',
                  'output',
                ]}
                onSelect={act(onOpenLogs)}
              >
                <ScrollText />
                <CommandRowLabel>{actionLabels.openLogs}</CommandRowLabel>
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {groupedNav.map(({ group, items }) => {
          const groupLabel = t(NAV_GROUP_LABEL_KEYS[group])
          return (
            <CommandGroup
              key={group}
              heading={t('commandPalette.group.goTo', { group: groupLabel })}
            >
              {items.map((item) => {
                const Icon = item.icon
                const label = t(item.labelKey)
                return (
                  <CommandItem
                    key={item.key}
                    value={`go to ${label}`}
                    keywords={[label, item.label, groupLabel]}
                    onSelect={act(item.run)}
                  >
                    <Icon />
                    <CommandRowLabel>{label}</CommandRowLabel>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )
        })}

        {agents.length > 0 && (
          <CommandGroup heading={t('commandPalette.group.agents')}>
            {agents.map((agent) => {
              const isActive = agent.name === activeAgent
              const agentLabel =
                agent.displayName?.trim() ||
                (agent.isDefault ? t('commandPalette.agent.defaultLabel') : agent.name)
              return (
                <CommandItem
                  key={agent.name}
                  value={`switch to agent ${agentLabel} ${agent.name}`}
                  keywords={['agent', 'profile', 'switch', agentLabel, agent.model ?? '']}
                  onSelect={act(() => onSwitchAgent(agent.name))}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {/* The avatar is an <img> Avatar, so the active-row icon
                      sweep never tints the face. */}
                  <Avatar avatarId={resolveAvatar(agent)} name={agent.name} size={24} />
                  <CommandRowLabel detail={agent.model ?? undefined}>{agentLabel}</CommandRowLabel>
                  {isActive ? (
                    <Check
                      className="text-primary"
                      aria-label={t('commandPalette.status.activeAgent')}
                    />
                  ) : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {sessionsLoading ? (
          <CommandGroup heading={t('commandPalette.group.sessions')}>
            <CommandItem
              value={sessionLabels.loading}
              keywords={[sessionLabels.loading, 'sessions', 'loading']}
              disabled
            >
              <MessagesSquare />
              <CommandRowLabel>{sessionLabels.loading}</CommandRowLabel>
            </CommandItem>
          </CommandGroup>
        ) : sessions.length > 0 ? (
          <CommandGroup heading={t('commandPalette.group.sessions')}>
            {sessions.map((s) => {
              const label =
                sanitizeSessionPreview(s.title) ||
                sanitizeSessionPreview(s.preview) ||
                sessionLabels.untitled
              return (
                <CommandItem
                  key={s.id}
                  value={label}
                  keywords={[s.model ?? '', s.preview]}
                  onSelect={act(() => onOpenSession(s.id))}
                >
                  <MessagesSquare />
                  <CommandRowLabel detail={s.model ?? undefined}>{label}</CommandRowLabel>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : (
          <CommandGroup heading={t('commandPalette.group.sessions')}>
            <CommandItem
              value={sessionLabels.empty}
              keywords={[sessionLabels.empty, 'sessions', 'history', 'empty']}
              disabled
            >
              <MessagesSquare />
              <CommandRowLabel>{sessionLabels.empty}</CommandRowLabel>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Start a fresh chat (clears the conversation). */
  onNewChat: () => void
  /** Clear the current conversation (offered when wired). */
  onClearChat?: () => void
}

/** Connected palette: wires NAV → router, the live session list, and the theme. */
export function CommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onClearChat,
}: CommandPaletteProps) {
  const navigate = useNavigate()
  const { resolvedTheme, toggle } = useTheme()
  const { palette, setPalette } = usePalette()
  // Only fetch the session list while the palette is open (cheap + cached).
  const sessionsQuery = useSessions({ limit: 50 })
  // The agent roster + the SHARED switchProfile (same honest restart caveat).
  const profilesQuery = useProfiles()
  const switchProfile = useSwitchProfile()
  const handleSwitchAgent = (name: string) => {
    switchProfile.mutate(name, {
      onSuccess: () => toast.info(switchAppliedLine(name)),
      onError: (err) =>
        toast.error('Couldn’t set the active agent', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }

  // The Maintenance dock actions. "Restart gateway" fires the REAL restart
  // mutation (the palette IS the explicit confirmation — you typed it and pressed
  // enter) with an honest result toast; the full confirm-copy affordance lives on
  // the System surface. "Check for Hermes updates" re-runs the real probe (re-
  // reads the dock). Neither fakes a state.
  const restartGateway = useRestartGateway()
  const checkSystem = useCheckSystem()
  const handleRestartGateway = () => {
    restartGateway.mutate(undefined, {
      onSuccess: (state) =>
        state.status === 'running'
          ? toast.success('Gateway restarted', { description: 'Your agent is back online.' })
          : toast.warning('Gateway restarted', {
              description: `It is reporting "${state.status}". Open System to check.`,
            }),
      onError: (err) =>
        toast.error('Couldn’t restart your agent', {
          description: err instanceof Error ? err.message : 'Please try again.',
        }),
    })
  }
  const handleCheckHermesUpdates = () => {
    checkSystem()
    toast.info('Checking for Hermes updates…', { description: 'Open System to see the result.' })
  }

  const navItems: PaletteNavItem[] = NAV.filter((n) => !n.hidden).map((n) => ({
    key: n.key,
    label: n.label,
    labelKey: n.labelKey,
    group: n.group,
    icon: n.icon,
    // Jumping to a surface only navigates; the explicit "New chat" action is the
    // one that clears the conversation.
    run: () => navigate(n.path),
  }))

  return (
    <CommandPaletteView
      open={open}
      onOpenChange={onOpenChange}
      navItems={navItems}
      sessions={sessionsQuery.data?.sessions ?? []}
      sessionsLoading={sessionsQuery.isLoading}
      onOpenSession={(id) => navigate(`/sessions/${id}`)}
      onNewChat={onNewChat}
      onToggleTheme={toggle}
      resolvedTheme={resolvedTheme}
      activePalette={palette}
      onSetPalette={setPalette}
      onClearChat={onClearChat}
      onRestartGateway={handleRestartGateway}
      onCheckHermesUpdates={handleCheckHermesUpdates}
      onOpenSystem={() => navigate('/system')}
      onOpenLogs={() => navigate('/logs')}
      onOpenMessaging={() => navigate('/connections?tab=messaging')}
      onOpenMcp={() => navigate('/connections?tab=mcp')}
      onOpenVoice={() => navigate('/connections?tab=voice')}
      agents={profilesQuery.data?.profiles ?? []}
      activeAgent={profilesQuery.data?.active ?? ''}
      onSwitchAgent={handleSwitchAgent}
    />
  )
}
