/**
 * Pure display helpers for the Jobs surface — relative-time rendering for next/
 * last run, and the governed semantic tone for a job's last-run status. Kept pure
 * (no React) so they're trivially unit-tested.
 */
import type { CronJob, CronJobStatus, CronSchedule } from './types'

/** Map a job's last-run status to a governed semantic Badge variant (NOT the action accent). */
export function statusTone(
  status: CronJobStatus | null,
): 'success' | 'destructive' | 'warning' | 'muted' {
  switch (status) {
    case 'ok':
      return 'success'
    case 'error':
      return 'destructive'
    case 'skipped':
      return 'warning'
    default:
      return 'muted'
  }
}

/** A short human label for a last-run status (null = never run). */
export function statusLabel(status: CronJobStatus | null): string {
  switch (status) {
    case 'ok':
      return 'OK'
    case 'error':
      return 'Failed'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Never run'
  }
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * Render an ISO timestamp as a compact relative string ("in 3h", "5m ago", "now").
 * Returns null for a null/unparseable input so callers can show an em dash. `now`
 * is injectable for deterministic tests.
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const diff = t - now
  const ahead = diff >= 0
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'now'
  let value: number
  let unit: string
  if (abs < HOUR) {
    value = Math.round(abs / MIN)
    unit = 'm'
  } else if (abs < DAY) {
    value = Math.round(abs / HOUR)
    unit = 'h'
  } else {
    value = Math.round(abs / DAY)
    unit = 'd'
  }
  return ahead ? `in ${value}${unit}` : `${value}${unit} ago`
}

/** Pretty-print an hour+minute as "8:00am" / "2:30pm" (mirrors the NL-picker labels). */
function timeOfDay(hour: number, minute: number): string {
  const period = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${minute.toString().padStart(2, '0')}${period}`
}

const CRON_DAY_LABEL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/**
 * Render a 5-field cron expression in plain words for the shapes the NL schedule
 * picker emits (and the common hand-typed ones): every minute / every N minutes /
 * every hour / every N hours / daily / weekday / weekend / single-weekday at a
 * time. Returns null for anything else so the caller falls back to the raw
 * display instead of guessing wrong.
 */
function cronInWords(expr: string): string | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string]
  // Only day-of-month/month wildcards are supported — anything else falls back.
  if (dom !== '*' || month !== '*') return null

  if (hour === '*' && dow === '*') {
    if (min === '*') return 'Every minute'
    const step = /^\*\/(\d+)$/.exec(min)
    if (step) {
      const n = Number(step[1])
      return n === 1 ? 'Every minute' : `Every ${n} minutes`
    }
    if (min === '0') return 'Every hour'
    return null
  }
  if (min === '0' && dow === '*') {
    const step = /^\*\/(\d+)$/.exec(hour)
    if (step) {
      const n = Number(step[1])
      return n === 1 ? 'Every hour' : `Every ${n} hours`
    }
  }

  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour)) return null
  const m = Number(min)
  const h = Number(hour)
  if (m > 59 || h > 23) return null
  const at = timeOfDay(h, m)

  if (dow === '*') return `Every day at ${at}`
  if (dow === '1-5') return `Every weekday at ${at}`
  if (dow === '0,6' || dow === '6,0') return `Every weekend at ${at}`
  if (/^[0-7]$/.test(dow)) return `Every ${CRON_DAY_LABEL[Number(dow) % 7]} at ${at}`
  return null
}

/**
 * The plain-words lead line for a job's schedule. Cron expressions become words
 * for every shape the NL picker can produce ("0 9 * * 1-5" → "Every weekday at
 * 9:00am"), intervals become "Every N minutes/hours", and anything we can't
 * honestly word falls back to the scheduler's own display string.
 */
export function scheduleInWords(schedule: CronSchedule): string {
  if (schedule.kind === 'interval' && schedule.minutes != null && schedule.minutes > 0) {
    const m = schedule.minutes
    if (m % 60 === 0) {
      const h = m / 60
      return h === 1 ? 'Every hour' : `Every ${h} hours`
    }
    return m === 1 ? 'Every minute' : `Every ${m} minutes`
  }
  if (schedule.kind === 'cron' && schedule.expr) {
    return cronInWords(schedule.expr) ?? schedule.display
  }
  return schedule.display
}

/** The total runs label for a job ("4 runs" / "1 of 3 runs"). */
export function runsLabel(job: Pick<CronJob, 'runCount' | 'repeatTimes'>): string {
  if (job.repeatTimes != null) return `${job.runCount} of ${job.repeatTimes} runs`
  return `${job.runCount} run${job.runCount === 1 ? '' : 's'}`
}

/**
 * Pretty platform labels for the chat/notification platforms the hermes scheduler
 * delivers to (mirrors cron/scheduler.py `_KNOWN_DELIVERY_PLATFORMS`). An unknown
 * platform is title-cased rather than echoed raw, so the UI never shows a bare token.
 */
const PLATFORM_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  homeassistant: 'Home Assistant',
  dingtalk: 'DingTalk',
  feishu: 'Feishu',
  wecom: 'WeCom',
  weixin: 'WeChat',
  sms: 'SMS',
  email: 'Email',
  webhook: 'Webhook',
  bluebubbles: 'BlueBubbles',
  qqbot: 'QQ Bot',
  yuanbao: 'Yuanbao',
}

/** Title-case a platform token we don't have an explicit label for. */
function platformLabel(name: string): string {
  return PLATFORM_LABELS[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

/** A humanized delivery target — never a bare raw id (the raw value lives in `full`). */
export interface DeliverDisplay {
  /** The platform label (e.g. "Telegram"), or a friendly word for "origin". */
  label: string
  /** A short, friendly target (e.g. "…7894 · thread 18975"), or null when none. */
  target: string | null
  /** The exact raw delivery value, for a title tooltip + copy fidelity. */
  full: string
}

/** Shorten a chat id so a long telegram/discord id reads as a tail, not a wall. */
function shortChatId(chatId: string): string {
  const trimmed = chatId.trim()
  if (trimmed.length <= 6) return trimmed
  return `…${trimmed.slice(-4)}`
}

/**
 * Humanize a cron job's raw `deliver` value into a platform label + a friendly,
 * short target, keeping the exact raw string in `full` for a title tooltip. Returns
 * null for `local`/empty (nothing is delivered, so there's nothing to surface).
 *
 * Forms (see cron/scheduler.py `_resolve_single_delivery_target`):
 *   - "local" / ""                    → null (in-place, no delivery)
 *   - "origin"                        → "Where it was created"
 *   - "telegram"                      → "Telegram" (configured home channel)
 *   - "telegram:-100123"              → "Telegram" + "…0123"
 *   - "telegram:-100123:18975"        → "Telegram" + "…0123 · thread 18975"
 */
export function humanizeDeliver(deliver: string): DeliverDisplay | null {
  const value = deliver.trim()
  if (value === '' || value === 'local') return null
  if (value === 'origin') {
    return { label: 'Where it was created', target: null, full: value }
  }
  if (!value.includes(':')) {
    return { label: platformLabel(value), target: null, full: value }
  }
  const [platform, chatId, thread] = value.split(':')
  const label = platformLabel(platform ?? value)
  const chatPart = chatId ? shortChatId(chatId) : null
  const target = chatPart && thread ? `${chatPart} · thread ${thread}` : (chatPart ?? null)
  return { label, target, full: value }
}
