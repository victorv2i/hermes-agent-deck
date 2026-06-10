/**
 * nlSchedule — a small PURE plain-language → cron translator for the Jobs surface,
 * so a non-technical user can type "every morning at 8" instead of "0 8 * * *".
 *
 * HONESTY is the contract: a recognized phrase returns the EXACT 5-field cron it
 * becomes (the UI shows it verbatim); an UNRECOGNIZED phrase returns `null` so the
 * caller falls back to the raw cron field rather than silently guessing wrong. We
 * never invent a schedule the user didn't ask for.
 *
 * Grammar (case-insensitive, whitespace-trimmed):
 *   FREQUENCY (one of):
 *     every minute                         -> star-minute (every minute)
 *     every N minutes                      -> step minute, N divides 60
 *     hourly | every hour                  -> top of every hour
 *     every N hours                        -> step hour, N divides 24
 *     daily | every day | everyday         -> midnight daily (+ optional time)
 *     every morning|afternoon|evening|night-> a default time, daily
 *     weekday[s] | every weekday           -> Mon-Fri (+ optional time)
 *     weekend | every weekend              -> Sat,Sun (+ optional time)
 *     weekly on <day> | every <day>        -> that weekday (+ optional time)
 *   TIME (optional, appended to a day/weekday/weekly/daily frequency):
 *     at <h>[:<m>][am|pm] | at noon | at midnight
 *   A BARE time ("at 9am") is treated as a daily schedule at that time.
 *
 * The cron we emit is the standard 5-field form (minute hour day-of-month month
 * day-of-week) the hermes scheduler accepts directly.
 */

/** A successful parse: the cron it maps to + a short human label for the preview. */
export interface ParsedSchedule {
  /** The 5-field cron expression (e.g. "0 8 * * *"). */
  cron: string
  /** A short, human rendering of what was understood (e.g. "Every day at 8:00am"). */
  label: string
}

interface Time {
  hour: number
  minute: number
}

const DOW: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Named times-of-day → a sensible default hour. */
const DAYPART: Record<string, number> = {
  morning: 8,
  afternoon: 14,
  evening: 18,
  night: 21,
}

/**
 * Parse a clock-time clause ("9", "9am", "9:30pm", "14:45", "noon", "midnight").
 * Returns null for an unparseable or out-of-range time. The leading "at " is
 * already stripped by the caller.
 */
function parseTime(raw: string): Time | null {
  const s = raw.trim().toLowerCase()
  if (s === 'noon') return { hour: 12, minute: 0 }
  if (s === 'midnight') return { hour: 0, minute: 0 }

  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const meridiem = m[3]

  if (minute > 59) return null

  if (meridiem) {
    // 12-hour clock: hour must be 1–12.
    if (hour < 1 || hour > 12) return null
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour
    else hour = hour === 12 ? 12 : hour + 12
  } else {
    // 24-hour clock: hour must be 0–23.
    if (hour > 23) return null
  }
  return { hour, minute }
}

/** Pretty-print a Time as "8:00am" / "2:30pm" for the human label. */
function formatTime(t: Time): string {
  const period = t.hour < 12 ? 'am' : 'pm'
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12
  const mm = t.minute.toString().padStart(2, '0')
  return `${h12}:${mm}${period}`
}

/** Largest exact divisor check — a cron step must divide evenly into its range. */
function dividesInto(step: number, range: number): boolean {
  return step >= 1 && step <= range && range % step === 0
}

/**
 * Parse a plain-language schedule phrase into a 5-field cron + a human label, or
 * `null` if it isn't one of the supported phrases (never a wrong guess).
 */
export function parseNlSchedule(input: string): ParsedSchedule | null {
  let text = input.trim().toLowerCase()
  if (text === '') return null

  // Pull off a trailing "at <time>" clause once, if present — it's the only place a
  // time may appear in the supported grammar.
  let time: Time | null = null
  const atMatch = /(?:^|\s+)at\s+(.+)$/.exec(text)
  if (atMatch) {
    const t = parseTime(atMatch[1] ?? '')
    if (!t) return null // an "at …" we can't read ⇒ don't guess
    time = t
    text = text.slice(0, atMatch.index).trim()
  }

  // A bare "at 9am" (whole phrase was just the time clause) ⇒ daily at that time.
  if (text === '' && time) {
    return { cron: `${time.minute} ${time.hour} * * *`, label: `Every day at ${formatTime(time)}` }
  }

  // Normalize a leading "every " / "weekly on " for the frequency matchers below.
  const everyN = /^every\s+(\d+)\s+(minute|minutes|hour|hours)$/.exec(text)
  if (everyN) {
    const n = Number(everyN[1])
    const unit = everyN[2] ?? ''
    if (unit.startsWith('minute')) {
      if (!dividesInto(n, 60)) return null
      const expr = n === 1 ? '* * * * *' : `*/${n} * * * *`
      return { cron: expr, label: n === 1 ? 'Every minute' : `Every ${n} minutes` }
    }
    // hours
    if (!dividesInto(n, 24)) return null
    const expr = n === 1 ? '0 * * * *' : `0 */${n} * * *`
    return { cron: expr, label: n === 1 ? 'Every hour' : `Every ${n} hours` }
  }

  if (text === 'every minute') return { cron: '* * * * *', label: 'Every minute' }
  if (text === 'hourly' || text === 'every hour') return { cron: '0 * * * *', label: 'Every hour' }

  // A daily/daypart/weekday/weekend/weekly frequency — all share the optional time,
  // defaulting to midnight (0 0) when none was given.
  const min = time?.minute ?? 0
  const hour = time?.hour ?? 0

  // Daypart words imply a default hour ONLY when no explicit time was given.
  for (const [word, defaultHour] of Object.entries(DAYPART)) {
    if (text === `every ${word}` || text === word) {
      const h = time ? hour : defaultHour
      const m = time ? min : 0
      const t: Time = { hour: h, minute: m }
      return { cron: `${m} ${h} * * *`, label: `Every ${word} at ${formatTime(t)}` }
    }
  }

  if (text === 'daily' || text === 'every day' || text === 'everyday') {
    const label = time ? `Every day at ${formatTime({ hour, minute: min })}` : 'Every day'
    return { cron: `${min} ${hour} * * *`, label }
  }

  if (text === 'weekday' || text === 'weekdays' || text === 'every weekday') {
    const label = time
      ? `Every weekday at ${formatTime({ hour, minute: min })}`
      : 'Every weekday (Mon–Fri)'
    return { cron: `${min} ${hour} * * 1-5`, label }
  }

  if (text === 'weekend' || text === 'every weekend') {
    const label = time
      ? `Every weekend at ${formatTime({ hour, minute: min })}`
      : 'Every weekend (Sat–Sun)'
    return { cron: `${min} ${hour} * * 0,6`, label }
  }

  // "weekly on <day>" or "every <day>".
  const weeklyOn = /^weekly\s+on\s+(\w+)$/.exec(text)
  const everyDay = /^every\s+(\w+)$/.exec(text)
  const dayWord = weeklyOn?.[1] ?? everyDay?.[1]
  if (dayWord && dayWord in DOW) {
    const dow = DOW[dayWord]!
    const label = time
      ? `Every ${DOW_LABEL[dow]} at ${formatTime({ hour, minute: min })}`
      : `Every ${DOW_LABEL[dow]}`
    return { cron: `${min} ${hour} * * ${dow}`, label }
  }

  return null
}

// ---------------------------------------------------------------------------
// Honest "next runs" preview — a tiny, dependency-free cron field evaluator that
// supports exactly the cron shapes parseNlSchedule emits (and common hand-typed
// ones): "*", a number, a list "a,b", a range "a-b", and a step "*/n". It walks
// forward minute-by-minute from `from`, which is plenty fast for a few previews.
// ---------------------------------------------------------------------------

/** Expand one cron field into the explicit set of values it matches within [min,max]. */
function fieldMatcher(field: string, min: number, max: number): Set<number> | null {
  const set = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/.exec(part)
    if (!stepMatch) return null
    const base = stepMatch[1] ?? ''
    const step = stepMatch[2] ? Number(stepMatch[2]) : 1
    if (step < 1) return null
    let lo = min
    let hi = max
    if (base === '*') {
      // full range with step
    } else if (base.includes('-')) {
      const [a, b] = base.split('-')
      lo = Number(a)
      hi = Number(b)
    } else {
      lo = Number(base)
      hi = Number(base)
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) return null
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) set.add(v)
  }
  return set.size ? set : null
}

interface CronSets {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
}

/** Parse a 5-field cron into per-field value sets, or null if malformed. */
function parseCronFields(expr: string): CronSets | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minF, hourF, domF, monthF, dowF] = fields as [string, string, string, string, string]
  const minute = fieldMatcher(minF, 0, 59)
  const hour = fieldMatcher(hourF, 0, 23)
  const dom = fieldMatcher(domF, 1, 31)
  const month = fieldMatcher(monthF, 1, 12)
  const dowRaw = fieldMatcher(dowF, 0, 7)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  // Cron allows 7 as Sunday; normalize it to 0.
  const dow = new Set<number>()
  for (const d of dowRaw) dow.add(d === 7 ? 0 : d)
  return { minute, hour, dom, month, dow }
}

/**
 * Whether a cron's day-of-month and day-of-week constrain the date. Standard cron
 * semantics: if BOTH dom and dow are restricted (not "*"), a date matches when
 * EITHER matches; if only one is restricted, only that one must match. We treat a
 * field as unrestricted when it spans its full range.
 */
function dateMatches(d: Date, sets: CronSets, domWild: boolean, dowWild: boolean): boolean {
  const monthOk = sets.month.has(d.getMonth() + 1)
  if (!monthOk) return false
  const domOk = sets.dom.has(d.getDate())
  const dowOk = sets.dow.has(d.getDay())
  if (domWild && dowWild) return true
  if (domWild) return dowOk
  if (dowWild) return domOk
  return domOk || dowOk
}

export interface NextRunsOptions {
  /** When to start searching from (exclusive of the current minute). */
  from?: Date
  /** How many upcoming fire times to return. */
  count?: number
}

/**
 * Compute the next `count` fire times of a 5-field cron at/after `from`. Returns an
 * empty array for an unparseable cron (so the preview can honestly say "—" instead
 * of throwing). Walks minute-by-minute up to a one-year safety horizon.
 */
export function nextRuns(expr: string, options: NextRunsOptions = {}): Date[] {
  const sets = parseCronFields(expr)
  if (!sets) return []
  const count = options.count ?? 3
  const from = options.from ?? new Date()

  const domWild = sets.dom.size === 31
  const dowWild = sets.dow.size === 7 || sets.dow.size === 8

  const out: Date[] = []
  // Start at the next whole minute so we never report "now" twice.
  const cursor = new Date(from)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  // One year of minutes is the hard cap — well beyond any supported phrase.
  const horizon = 366 * 24 * 60
  for (let i = 0; i < horizon && out.length < count; i++) {
    if (
      sets.minute.has(cursor.getMinutes()) &&
      sets.hour.has(cursor.getHours()) &&
      dateMatches(cursor, sets, domWild, dowWild)
    ) {
      out.push(new Date(cursor))
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return out
}
