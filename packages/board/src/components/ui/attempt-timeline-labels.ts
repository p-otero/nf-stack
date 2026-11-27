import type { AttemptStatus, AttemptView, ContextMode } from "@/lib/agent-task-types"

type CheckResult = NonNullable<AttemptView["checks"]>[number]["result"]

interface AttemptTimelineLabels {
  timeline: string
  kind: Partial<Record<string, string>>
  status: Record<AttemptStatus, string>
  started: string
  ended: string
  ranAs: string
  earlierRoutes: (count: number) => string
  earlierRoutesFor: (count: number, attempt: string) => string
  earlierRoutesTitle: string
  context: Record<ContextMode, string>
  from: string
  repairs: (attempt: string) => string
  checks: string
  check: Record<CheckResult, string>
  commits: string
  blocker: string
  retryAt: string
  thread: string
  /** Visible text of a thread's link button. */
  threadLink: string
  /** Accessible name of a thread's link button; must start with `threadLink`'s words. */
  openThread: (name: string) => string
  openSourceThread: (name: string) => string
  usage: string
  usageFor: (attempt: string) => string
  usageTable: (attempt: string) => string
  showEarlier: (count: number) => string
  hideEarlier: (count: number) => string
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const attemptTimelineLabels: AttemptTimelineLabels = {
  timeline: "Attempts",
  kind: {
    implementation: "Implementation",
    integration: "Integration",
    research: "Research",
    design: "Design",
    review: "Review",
  },
  status: {
    dispatching: "Dispatching",
    active: "Active",
    succeeded: "Succeeded",
    failed: "Failed",
    cancelled: "Cancelled",
    superseded: "Superseded",
    unknown: "Unknown",
  },
  started: "Started",
  ended: "Ended",
  ranAs: "ran as",
  earlierRoutes: (count) => plural(count, "earlier route", "earlier routes"),
  earlierRoutesFor: (count, attempt) => `${plural(count, "earlier route", "earlier routes")} for ${attempt}`,
  earlierRoutesTitle: "Earlier routes",
  context: { fresh: "Fresh context", reuse: "Reused context", fork: "Forked context", compact: "Compacted context" },
  from: "from",
  repairs: (attempt) => `Repairs ${attempt}`,
  checks: "Checks",
  check: { pass: "Passed", fail: "Failed", not_run: "Not run" },
  commits: "Commits",
  blocker: "Blocked",
  retryAt: "Retry at",
  thread: "Thread",
  threadLink: "Open thread",
  openThread: (name) => `Open thread ${name}`,
  openSourceThread: (name) => `Open origin ${name}`,
  usage: "Usage",
  usageFor: (attempt) => `Usage for ${attempt}`,
  usageTable: (attempt) => `${attempt} tokens and cost`,
  showEarlier: (count) => `Show ${plural(count, "earlier attempt", "earlier attempts")}`,
  hideEarlier: (count) => `Hide ${plural(count, "earlier attempt", "earlier attempts")}`,
}

const attemptTimelineLabelsEs: AttemptTimelineLabels = {
  timeline: "Intentos",
  kind: {
    implementation: "Implementación",
    integration: "Integración",
    research: "Investigación",
    design: "Diseño",
    review: "Revisión",
  },
  status: {
    dispatching: "Enviando",
    active: "Activo",
    succeeded: "Completado",
    failed: "Fallido",
    cancelled: "Cancelado",
    superseded: "Sustituido",
    unknown: "Desconocido",
  },
  started: "Inicio",
  ended: "Fin",
  ranAs: "ejecutado como",
  earlierRoutes: (count) => plural(count, "ruta anterior", "rutas anteriores"),
  earlierRoutesFor: (count, attempt) => `${plural(count, "ruta anterior", "rutas anteriores")} de ${attempt}`,
  earlierRoutesTitle: "Rutas anteriores",
  context: {
    fresh: "Contexto nuevo",
    reuse: "Contexto reutilizado",
    fork: "Contexto bifurcado",
    compact: "Contexto compactado",
  },
  from: "de",
  repairs: (attempt) => `Repara ${attempt}`,
  checks: "Comprobaciones",
  check: { pass: "Superada", fail: "Fallida", not_run: "Sin ejecutar" },
  commits: "Commits",
  blocker: "Bloqueado",
  retryAt: "Reintento",
  thread: "Hilo",
  threadLink: "Abrir hilo",
  openThread: (name) => `Abrir hilo ${name}`,
  openSourceThread: (name) => `Abrir origen ${name}`,
  usage: "Consumo",
  usageFor: (attempt) => `Consumo de ${attempt}`,
  usageTable: (attempt) => `Tokens y coste ${attempt}`,
  showEarlier: (count) => `Mostrar ${plural(count, "intento anterior", "intentos anteriores")}`,
  hideEarlier: (count) => `Ocultar ${plural(count, "intento anterior", "intentos anteriores")}`,
}

export { attemptTimelineLabels, attemptTimelineLabelsEs }
export type { AttemptTimelineLabels, CheckResult }
