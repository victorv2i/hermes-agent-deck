/**
 * The English ('en') message catalog — the SOURCE OF TRUTH for the app's UI
 * strings. Every other locale is a translation OF this catalog; `en` is always
 * complete, so it doubles as the fallback when a key is missing in another
 * locale (see `t()` in ./index.ts).
 *
 * ── HOW TO ADD A STRING (the mechanical pattern) ───────────────────────────
 *  1. Add a `'feature.scope.label': 'English text'` entry here. Keys are
 *     dot-namespaced by surface so they stay greppable + collision-free.
 *  2. In the component, call `const { t } = useTranslation()` then
 *     `t('feature.scope.label')`. TypeScript will only accept keys that exist
 *     in this object (the key union is DERIVED from `en` — see `MessageKey`).
 *  3. For dynamic values use `{name}` placeholders and pass `t(key, { name })`.
 *     A `{count}` style placeholder is just interpolation — no plural rules yet
 *     (kept deliberately small; pluralization can be layered on later).
 *
 * Only `en` lives here today. More locales are community-contributed later as
 * sibling catalogs (e.g. `messages.es.ts`) registered in ./index.ts; the
 * switcher in Settings stays honest until then ("more languages coming").
 *
 * Straight ASCII quotes only — curly quotes break the build.
 */

/**
 * The catalog is `as const` so its keys/values are literal types: the exported
 * `MessageKey` union (in ./index.ts) is derived from it, giving compile-time
 * safety that `t('...')` only ever receives a real key. A flat (not nested) map
 * keeps lookup trivial and the derived key union exact.
 */
export const en = {
  // ── App chrome: navigation registry ───────────────────────────────────────
  // Group KEYS stay stable/internal; only these LABELS are user-facing. Chat is
  // promoted to a pinned-top item (with Home), so there's no "Conversations"
  // group anymore — Files + Terminal form the "Workspace" group.
  'navigation.group.workspace.label': 'Workspace',
  'navigation.group.agent.label': 'Your agent',
  'navigation.group.activity.label': 'Activity',
  'navigation.item.home.label': 'Home',
  'navigation.item.chat.label': 'Chat',
  // The History destination folded into Chat in the nav; its route survives, so
  // the label key stays (read by surfaceTitle for /history + /sessions/:id).
  'navigation.item.chats.label': 'History',
  'navigation.item.sessions.label': 'Sessions',
  'navigation.item.files.label': 'Files',
  'navigation.item.kanban.label': 'Board',
  'navigation.item.jobs.label': 'Tasks',
  'navigation.item.terminal.label': 'Terminal',
  'navigation.item.profiles.label': 'Agents',
  'navigation.item.tools.label': 'Tools',
  'navigation.item.connections.label': 'Connections',
  'navigation.item.agent-detail.label': 'Agent',
  'navigation.item.usage.label': 'Usage',
  'navigation.item.logs.label': 'Logs',
  'navigation.item.system.label': 'System',
  'navigation.item.settings.label': 'Settings',

  // ── App chrome: command palette ───────────────────────────────────────────
  'commandPalette.dialog.label': 'Command menu',
  'commandPalette.search.placeholder': 'Search commands, sessions, agents, themes…',
  'commandPalette.empty': 'No matching command, surface, session, or agent.',
  'commandPalette.group.actions': 'Actions',
  'commandPalette.group.appearance': 'Appearance',
  'commandPalette.group.maintenanceAndLogs': 'Maintenance & logs',
  'commandPalette.group.goTo': 'Go to · {group}',
  'commandPalette.group.agents': 'Agents',
  'commandPalette.group.sessions': 'Sessions',
  'commandPalette.action.newChat': 'New chat',
  'commandPalette.action.clearChat': 'Clear chat',
  'commandPalette.action.switchToLightTheme': 'Switch to light theme',
  'commandPalette.action.switchToDarkTheme': 'Switch to dark theme',
  'commandPalette.action.messaging': 'Messaging',
  'commandPalette.action.mcp': 'MCP',
  'commandPalette.action.voice': 'Voice',
  'commandPalette.action.setThemeTo': 'Set theme to {theme}',
  'commandPalette.action.restartGateway': 'Restart your agent',
  'commandPalette.action.checkHermesUpdates': 'Check for Hermes updates',
  'commandPalette.action.openSystem': 'Open System',
  'commandPalette.action.openLogs': 'Open Logs',
  'commandPalette.agent.defaultLabel': 'Your agent',
  'commandPalette.status.activeTheme': 'Active theme',
  'commandPalette.status.activeAgent': 'Active agent',
  'commandPalette.session.loading': 'Loading recent sessions…',
  'commandPalette.session.untitled': 'Untitled session',
  'commandPalette.session.empty': 'No recent sessions',

  // ── App chrome: keyboard shortcuts overlay ────────────────────────────────
  'shortcutsOverlay.title': 'Keyboard shortcuts',
  'shortcutsOverlay.description': 'Move around Agent Deck without leaving the keyboard.',
  'shortcutsOverlay.shortcut.commandPalette': 'Command palette',
  'shortcutsOverlay.shortcut.togglePreviewPanel': 'Toggle the Preview panel',
  'shortcutsOverlay.shortcut.toggleSessionsPane': 'Toggle the sessions pane',
  'shortcutsOverlay.shortcut.newChat': 'New chat',
  'shortcutsOverlay.shortcut.moveThroughSessions': 'Move through sessions in the rail',
  'shortcutsOverlay.shortcut.openFocusedSession': 'Open the focused session',
  'shortcutsOverlay.shortcut.openComposerCommandMenu': 'Open the command menu in the composer',
  'shortcutsOverlay.shortcut.abortOrClose': 'Abort the running response · close overlays',
  'shortcutsOverlay.shortcut.showReference': 'Show this shortcut reference',

  // ── Settings surface ──────────────────────────────────────────────────────
  // Migrated as the first worked example of the t() pattern. The rest of the
  // app is wrapped incrementally in a later pass; these prove the plumbing.
  'settings.title': 'Settings',
  'settings.subtitle':
    "Your in-browser preferences and your agent's configuration. A few safe config fields can be edited here; the rest stays read-only with a pointer to where to change it. Secrets are masked and never leave the server.",
  'settings.group.preferences.title': 'Your preferences',
  'settings.group.preferences.description':
    "Saved in this browser. They change how Agent Deck looks and behaves for you; they don't touch the agent's configuration.",
  'settings.group.agentConfig.title': 'Agent config',
  'settings.group.agentConfig.description':
    "Your agent's configuration, grouped by section. A few safe fields can be edited inline; the rest is read-only.",

  // ── Locale switcher (the i18n control itself) ─────────────────────────────
  'settings.locale.title': 'Language',
  'settings.locale.description': 'The language Agent Deck is shown in. Saved in this browser.',
  'settings.locale.comingSoon': 'More languages coming. Contributions welcome.',

  // ── Language display names (one per supported locale) ─────────────────────
  'locale.name.en': 'English',
} as const
