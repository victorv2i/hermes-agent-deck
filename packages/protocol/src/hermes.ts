import { z } from 'zod'

/**
 * Stock-hermes vocabulary enums — the GOVERNED string sets that the BFF and web
 * client share so a session's `source` / `end_reason` / a platform `name` is
 * validated against the SAME closed vocabulary the hermes agent itself writes.
 *
 * Every member below is hand-transcribed from STOCK hermes v0.15.2 source
 * (an editable install of the hermes-agent repo) and annotated with its
 * exact source line. These mirror upstream reality — they are NOT a wishlist.
 * When stock adds a value, the membership-count unit test in `hermes.test.ts`
 * fails, forcing a deliberate, cited update here rather than silent drift.
 *
 * WHY zod enums and not free `z.string()`: the three vocabularies are how the
 * session surface labels, filters, and colours rows. Pinning them lets the UI
 * switch exhaustively (a new upstream reason is a compile/test signal, not a
 * blank badge), while `*Loose` variants below keep the wire tolerant so an
 * unknown future value never 500s a read-only proxy.
 */

/**
 * `sessions.source` — the origin tag written at session creation
 * (`hermes_state.py:227`, the `source TEXT NOT NULL` column;
 * `create_session(session_id, source, …)` at `hermes_state.py:801`).
 *
 * Source is OPEN text in stock: it is the active PLATFORM name (so every
 * {@link PlatformEnum} value can appear here verbatim) OR one of the
 * process-origin tags below for non-platform entry points. The hermes_state.py
 * header documents it as "Session source tagging ('cli', 'telegram',
 * 'discord', etc.)" (`hermes_state.py:14`), and the dashboard sessions API
 * passes it through unmodified (`web_server.py:875`, `"source": m.get("source")`).
 *
 * This enum pins the PROCESS-ORIGIN tags actually emitted by non-test
 * `create_session(...)` call sites in stock; platform-name sources are covered
 * by {@link PlatformEnum}. Use {@link SessionSourceLoose} on the wire to also
 * accept any platform-name source (and future tags) without rejecting the row.
 */
export const SessionSourceEnum = z.enum([
  'cli', //         hermes_cli/main.py:1725  — interactive CLI session
  'tui', //         hermes_cli/main.py:1111  — TUI gateway session
  'gateway', //     create_session(source="gateway") — multi-platform gateway origin
  'api_server', //  run_agent.py:482 default lane — HTTP API-server session
  'acp', //         create_session(source="acp") — Agent Client Protocol session
  'tool', //        create_session(source="tool") — tool/sub-agent spawned session
])
export type SessionSource = z.infer<typeof SessionSourceEnum>

/**
 * Wire-tolerant session source: any {@link SessionSourceEnum} process-origin
 * tag, any {@link PlatformEnum} platform name (platform sessions tag `source`
 * with their platform), or any other string a future stock build may write.
 * Read-only proxies use this so an unknown source never rejects a real row.
 */
export const SessionSourceLoose = z.string()
export type SessionSourceLooseValue = z.infer<typeof SessionSourceLoose>

/**
 * `sessions.end_reason` — why a session row was closed
 * (`hermes_state.py:235`, the `end_reason TEXT` column;
 * `end_session(session_id, end_reason)` at `hermes_state.py:805-819`).
 *
 * The PRODUCTION vocabulary — every value emitted by a non-test
 * `end_session(...)` / `_finalize_session(...)` call in stock. Test-only
 * fixtures (`compressed`, `done`, `timeout`, `tui_close`, `user_exit`) are
 * deliberately EXCLUDED: they never appear in shipping code paths.
 */
export const SessionEndReasonEnum = z.enum([
  'branched', //              hermes_state.py:1433/1441 — parent split for a /branch
  'cli_close', //             cli.py:15027              — CLI session closed
  'compression', //           hermes_state.py:809       — context-compression split
  'cron_complete', //         cron/scheduler.py:1830    — scheduled cron run finished
  'new_session', //           cli.py:6462               — superseded by a fresh session
  'orphaned_compression', //  hermes_state.py:1128/1138 — repaired dangling compression child
  'resumed_other', //         cli.py:6786               — ended because another session resumed
  'session_reset', //         gateway/session.py:945    — gateway /reset
  'session_switch', //        gateway/session.py:1225   — gateway switched active session
  'tui_shutdown', //          tui_gateway/server.py:327 — TUI gateway shut down
])
export type SessionEndReason = z.infer<typeof SessionEndReasonEnum>

/**
 * Wire-tolerant end reason: a known {@link SessionEndReasonEnum} value or any
 * other string (open sessions carry `null`, handled by callers). Read-only
 * proxies use this so an unrecognised reason never rejects a real row.
 */
export const SessionEndReasonLoose = z.string()
export type SessionEndReasonLooseValue = z.infer<typeof SessionEndReasonLoose>

/**
 * `Platform` — the messaging/transport platforms hermes supports
 * (`gateway/config.py:100-129`, `class Platform(Enum)`). The 22 BUILT-IN
 * members with explicit `= "<slug>"` values, in source order `local`..`yuanbao`.
 *
 * Stock's `Platform._missing_` (`gateway/config.py:130`) additionally mints
 * dynamic members on demand for installed plugin adapters (e.g. `irc`), so the
 * runtime set is OPEN. This enum pins the built-in 22; use {@link PlatformLoose}
 * on the wire to also accept plugin-adapter platform names.
 */
export const PlatformEnum = z.enum([
  'local', //            gateway/config.py:108
  'telegram', //         gateway/config.py:109
  'discord', //          gateway/config.py:110
  'whatsapp', //         gateway/config.py:111
  'slack', //            gateway/config.py:112
  'signal', //           gateway/config.py:113
  'mattermost', //       gateway/config.py:114
  'matrix', //           gateway/config.py:115
  'homeassistant', //    gateway/config.py:116
  'email', //            gateway/config.py:117
  'sms', //              gateway/config.py:118
  'dingtalk', //         gateway/config.py:119
  'api_server', //       gateway/config.py:120
  'webhook', //          gateway/config.py:121
  'msgraph_webhook', //  gateway/config.py:122
  'feishu', //           gateway/config.py:123
  'wecom', //            gateway/config.py:124
  'wecom_callback', //   gateway/config.py:125
  'weixin', //           gateway/config.py:126
  'bluebubbles', //      gateway/config.py:127
  'qqbot', //            gateway/config.py:128
  'yuanbao', //          gateway/config.py:129
])
export type Platform = z.infer<typeof PlatformEnum>

/**
 * Wire-tolerant platform: a built-in {@link PlatformEnum} member or any other
 * string a plugin adapter may register via `Platform._missing_`. Read-only
 * proxies use this so an installed-plugin platform never rejects a real row.
 */
export const PlatformLoose = z.string()
export type PlatformLooseValue = z.infer<typeof PlatformLoose>
