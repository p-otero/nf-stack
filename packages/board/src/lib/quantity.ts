type Quality = "measured" | "estimated" | "derived" | "unknown"

interface Quantity {
  value: number | null
  quality: Quality
  source?: string
}

type QuantityLabels = Record<Quality, string>

interface FormatQuantityOptions {
  format?: (value: number) => string
  locale?: string
  labels?: Partial<QuantityLabels>
}

interface FormattedQuantity {
  text: string
  srText: string
  title: string | undefined
  quality: Quality
}

const defaultQuantityLabels: QuantityLabels = {
  measured: "measured",
  estimated: "estimated",
  derived: "derived",
  unknown: "unknown",
}

const UNKNOWN_TEXT = "—"

function isQuantity(value: unknown): value is Quantity {
  return typeof value === "object" && value !== null && "quality" in value && "value" in value
}

function formatQuantity(quantity: Quantity, options: FormatQuantityOptions = {}): FormattedQuantity {
  const labels = { ...defaultQuantityLabels, ...options.labels }
  const { value, source } = quantity
  const known = quantity.quality !== "unknown" && value !== null && Number.isFinite(value)
  const quality: Quality = known ? quantity.quality : "unknown"
  const title = quality === "measured" && !source ? undefined : [labels[quality], source].filter(Boolean).join(": ")

  if (!known) return { text: UNKNOWN_TEXT, srText: labels.unknown, title, quality }

  const format = options.format ?? new Intl.NumberFormat(options.locale).format
  const number = format(value)
  if (quality === "estimated") return { text: `~${number}`, srText: `${number} (${labels.estimated})`, title, quality }
  return { text: number, srText: number, title, quality }
}

export { defaultQuantityLabels, formatQuantity, isQuantity }
export type { FormatQuantityOptions, FormattedQuantity, Quality, Quantity, QuantityLabels }
