type Instant = string | number | Date

interface FormatRelativeOptions {
  now?: Instant
  locale?: string
  numeric?: Intl.RelativeTimeFormatNumeric
  style?: Intl.RelativeTimeFormatStyle
}

interface FormatInstantOptions {
  locale?: string
  timeZone?: string
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"]
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"]
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

const units: [Intl.RelativeTimeFormatUnit, number, number][] = [
  ["second", SECOND, MINUTE],
  ["minute", MINUTE, HOUR],
  ["hour", HOUR, DAY],
  ["day", DAY, WEEK],
  ["week", WEEK, MONTH],
  ["month", MONTH, YEAR],
]

function unitFor(diff: number): [Intl.RelativeTimeFormatUnit, number] {
  for (const [unit, size, limit] of units) if (Math.abs(diff) < limit) return [unit, size]
  return ["year", YEAR]
}

const INVALID_TEXT = "—"

function toTime(value: Instant) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function toISO(value: Instant) {
  const time = toTime(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

function formatRelative(value: Instant, options: FormatRelativeOptions = {}) {
  const time = toTime(value)
  const now = options.now === undefined ? Date.now() : toTime(options.now)
  if (Number.isNaN(time) || Number.isNaN(now)) return INVALID_TEXT
  const diff = time - now
  const [unit, size] = unitFor(diff)
  const formatter = new Intl.RelativeTimeFormat(options.locale, {
    numeric: options.numeric ?? "auto",
    style: options.style ?? "long",
  })
  return formatter.format(Math.round(diff / size), unit)
}

function resolvedTimeZone(timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().timeZone
}

function zoneName(time: number, locale: string | undefined, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
    .formatToParts(time)
    .find((part) => part.type === "timeZoneName")?.value
}

function formatInstant(value: Instant, options: FormatInstantOptions = {}) {
  const time = toTime(value)
  if (Number.isNaN(time)) return INVALID_TEXT
  const { locale, timeZone } = options
  const text = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: options.dateStyle ?? "medium",
    timeStyle: options.timeStyle ?? "short",
  }).format(time)
  if (!timeZone) return text
  const zone = resolvedTimeZone(timeZone)
  if (zone === resolvedTimeZone()) return text
  const name = zoneName(time, locale, zone)
  return name ? `${text} ${name}` : text
}

const elapsedFormats = new Map<string, Intl.NumberFormat>()

/**
 * How long ago, in the largest whole unit and the locale's narrowest form ("26m", "3h", "2d"), for a dense column
 * beside a full date in a tooltip or an accessible name. Future instants read as 0 of the smallest unit.
 */
function formatElapsed(value: Instant, options: Pick<FormatRelativeOptions, "now" | "locale"> = {}) {
  const time = toTime(value)
  const now = options.now === undefined ? Date.now() : toTime(options.now)
  if (Number.isNaN(time) || Number.isNaN(now)) return INVALID_TEXT
  const diff = Math.max(0, now - time)
  const [unit, size] = diff < MINUTE ? (["second", SECOND] as const) : unitFor(diff)
  const key = `${options.locale ?? ""}|${unit}`
  let format = elapsedFormats.get(key)
  if (!format) {
    // English narrows both minutes and months to "m"; months keep the short form.
    const unitDisplay = unit === "month" ? "short" : "narrow"
    format = new Intl.NumberFormat(options.locale, { style: "unit", unit, unitDisplay })
    elapsedFormats.set(key, format)
  }
  return format.format(Math.floor(diff / size))
}

export { formatElapsed, formatInstant, formatRelative, toISO, toTime }
export type { FormatInstantOptions, FormatRelativeOptions, Instant }
