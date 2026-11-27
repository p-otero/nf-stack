import type { TaskLink, TaskStatus } from "@/lib/agent-task-types"
import { assumeType } from "@/lib/narrow"

interface ProposalLabels {
  /** Accessible name of the agent-only proposals group. */
  group: string
  approve: string
  approveName: (taskId: string) => string
  approving: string
  reject: string
  rejectName: (taskId: string) => string
  rejectTitle: (taskId: string) => string
  rejectDescription: string
  /** Must not repeat the reject trigger's words: an agent's press matches whole words. */
  rejectConfirm: string
  rejecting: string
  cancel: string
  approveAgentConfirm: (taskId: string) => string
  rejectAgentConfirm: (taskId: string) => string
  /** The board-level mark, shared by every proposal. */
  agentConfirm: string
}

/** What a card's move is, for announcements: picked up, moved, dropped or put back. */
interface TaskMoveMessage {
  type: "grab" | "move" | "drop" | "cancel"
  label: string
  /** The column's name. */
  list: string
  position: number
  total: number
}

interface MoveLabels {
  /** Accessible name of the agent-only group that moves tasks. */
  group: string
  /** A card's drag handle. */
  handle: (title: string) => string
  /** The handle's `aria-roledescription`. */
  item: string
  instructions: string
  message: (message: TaskMoveMessage) => string
  /** The mark an agent shows a person before moving a task to another column. */
  agentConfirm: string
}

/**
 * Labels of the pieces the board composes (AgentBadge, LivenessIndicator,
 * UsageTable, AttemptTimeline), keyed by component, each its own Partial labels.
 * Typed loosely here so this file needs no component; AgentTaskBoard narrows it.
 */
type AgentTaskBoardComponentLabels = Record<string, Record<string, unknown>>

interface CardLabels {
  /** Accessible name of the button that selects the card; must contain the visible title. */
  open: (id: string, title: string) => string
  attempts: (count: number) => string
  cost: string
  acceptance: (id: string) => string
  dependencies: (id: string) => string
  decisionNeeded: string
  /** Precedes the relative time of the last change, as in "Updated 2 minutes ago". */
  updated: string
  /** Precedes the relative retry time, as in "Retry in 3 hours". */
  retry: string
  analysisMode: { review: string; autonomous: string }
  /** Accessible name of the card's pull request icon link. */
  openPullRequest: (label: string) => string
  /** Read after the card's paperclip count. */
  attachments: (count: number) => string
}

interface LinkLabels {
  kind: Record<TaskLink["kind"], string>
  state: Record<NonNullable<TaskLink["state"]>, string>
}

interface PanelLabels {
  close: string
  goal: string
  acceptance: string
  noAcceptance: string
  dependencies: string
  dependenciesOf: (id: string) => string
  decision: string
  usage: string
  usageOf: (id: string) => string
  attempts: string
  updated: string
  cost: string
  profile: string
  project: string
  status: string
  labels: string
  links: string
  linksOf: (id: string) => string
  activity: string
  attachments: string
  attachmentsOf: (id: string) => string
  location: string
  /** Names the stage track of a task. */
  locationOf: (id: string) => string
  attemptsSummary: string
  counts: { attempts: string; repairs: string; reviews: string; humanInterventions: string }
  acceptedFirstPass: string
  yes: string
  no: string
}

type TableColumn = "id" | "title" | "status" | "profile" | "agent" | "attempts" | "cost" | "updatedAt"

interface TableLabels {
  name: string
  columns: Record<TableColumn, string>
  sortBy: (column: string) => string
}

interface AgentTaskBoardLabels {
  board: string
  columns: Record<TaskStatus, string>
  ready: string
  waiting: string
  filters: {
    group: string
    project: string
    allProjects: string
    profile: string
    anyProfile: string
    model: string
    anyModel: string
    search: string
    searchPlaceholder: string
    clearSearch: string
    clear: string
    /** Names the row of stage toggles. */
    stage: string
    /** The last stage toggle, for tasks without a location; agents can pass it to `filter({ stage })`. */
    noStage: string
  }
  views: { group: string; board: string; table: string; backlog: string }
  backlog: { name: string; proposed: string; notReady: string }
  summary: {
    group: string
    total: string
    acceptedFirstPass: string
    acceptedFirstPassValue: (accepted: number, rated: number) => string
    cost: string
    awaitingDecision: string
  }
  proposals: ProposalLabels
  moves: MoveLabels
  snapshot: (date: string) => string
  empty: { board: string; column: string; filtered: string; attempts: string; backlog: string }
  errors: { approveFailed: string; rejectFailed: string; unknown: string }
  card: CardLabels
  panel: PanelLabels
  link: LinkLabels
  /** Visible text of a thread's link; the thread's name goes in its accessible name and its id in a tooltip. */
  openThread: string
  table: TableLabels
  components: AgentTaskBoardComponentLabels
}

/** Every top-level key optional, and every object one level down optional too. */
type AgentTaskBoardLabelsInput = {
  [Key in keyof AgentTaskBoardLabels]?: AgentTaskBoardLabels[Key] extends (...args: never[]) => unknown
    ? AgentTaskBoardLabels[Key]
    : AgentTaskBoardLabels[Key] extends object
      ? Partial<AgentTaskBoardLabels[Key]>
      : AgentTaskBoardLabels[Key]
}

const agentTaskBoardLabels: AgentTaskBoardLabels = {
  board: "Agent tasks",
  columns: {
    proposed: "Proposed",
    todo: "To do",
    working: "Working",
    review: "Review",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
  },
  ready: "Ready",
  waiting: "Waiting on dependencies",
  filters: {
    group: "Filters",
    project: "Project",
    allProjects: "All projects",
    profile: "Profile",
    anyProfile: "Any profile",
    model: "Model",
    anyModel: "Any model",
    search: "Search tasks",
    searchPlaceholder: "Search by ID, title or goal",
    clearSearch: "Clear search",
    clear: "Clear filters",
    stage: "Stage",
    noStage: "No stage",
  },
  views: { group: "View", board: "Board", table: "Table", backlog: "Backlog" },
  backlog: { name: "Backlog", proposed: "Proposed", notReady: "Not ready" },
  summary: {
    group: "Summary",
    total: "Tasks",
    acceptedFirstPass: "Accepted first pass",
    acceptedFirstPassValue: (accepted, rated) => `${accepted} of ${rated}`,
    cost: "Estimated cost",
    awaitingDecision: "Awaiting a decision",
  },
  moves: {
    group: "Task moves",
    handle: (title) => `Move ${title}`,
    item: "draggable task",
    instructions:
      "Press Space to pick up. Use Up and Down to move within a column, Left and Right to change columns, Space to drop, Escape to cancel.",
    message: ({ type, label, list, position, total }) => {
      if (type === "grab") return `Picked up ${label}. ${list}, position ${String(position)} of ${String(total)}.`
      if (type === "move") return `${label}: ${list}, position ${String(position)} of ${String(total)}.`
      if (type === "drop") return `Dropped ${label} in ${list}, position ${String(position)} of ${String(total)}.`
      return `Move canceled. ${label} is back in ${list}.`
    },
    agentConfirm: "Moves a task to another column, which changes its status",
  },
  proposals: {
    group: "Proposal decisions",
    approve: "Approve",
    approveName: (taskId) => `Approve proposal ${taskId}`,
    approving: "Approving proposal",
    reject: "Reject",
    rejectName: (taskId) => `Reject proposal ${taskId}`,
    rejectTitle: (taskId) => `Reject proposal ${taskId}?`,
    rejectDescription: "No agent starts on it, and it leaves the board.",
    rejectConfirm: "Discard it",
    rejecting: "Rejecting proposal",
    cancel: "Cancel",
    approveAgentConfirm: (taskId) => `Approves proposal ${taskId}, which starts agents`,
    rejectAgentConfirm: (taskId) => `Rejects proposal ${taskId}`,
    agentConfirm: "Approves or rejects a task proposal; approving starts agents",
  },
  snapshot: (date) => `Snapshot · ${date}`,
  empty: {
    board: "No tasks yet.",
    column: "Nothing here.",
    filtered: "No tasks match these filters.",
    attempts: "No attempts yet.",
    backlog: "Nothing in the backlog.",
  },
  errors: {
    approveFailed: "Couldn't approve the proposal.",
    rejectFailed: "Couldn't reject the proposal.",
    unknown: "Something went wrong.",
  },
  card: {
    open: (id, title) => `Open ${id} ${title}`,
    attempts: (count) => (count === 1 ? "1 attempt" : `${count} attempts`),
    cost: "Cost",
    acceptance: (id) => `Acceptance for ${id}`,
    dependencies: (id) => `Dependencies of ${id}`,
    decisionNeeded: "Decision needed",
    updated: "Updated",
    retry: "Retry",
    analysisMode: { review: "A person reviews it before agents run", autonomous: "Agents run it on their own" },
    openPullRequest: (label) => `Open pull request ${label}`,
    attachments: (count) => (count === 1 ? "1 attachment" : `${count} attachments`),
  },
  panel: {
    close: "Close task details",
    goal: "Goal",
    acceptance: "Acceptance",
    noAcceptance: "No acceptance criteria.",
    dependencies: "Dependencies",
    dependenciesOf: (id) => `Dependencies of ${id}`,
    decision: "Decision needed",
    usage: "Usage",
    usageOf: (id) => `Usage of ${id}`,
    attempts: "Attempts",
    updated: "Updated",
    cost: "Cost",
    profile: "Profile",
    project: "Project",
    status: "Status",
    labels: "Labels",
    links: "Links",
    linksOf: (id) => `Links of ${id}`,
    activity: "Activity",
    attachments: "Attachments",
    attachmentsOf: (id) => `Attachments of ${id}`,
    location: "Location",
    locationOf: (id) => `Stage of ${id}`,
    attemptsSummary: "Work",
    counts: { attempts: "Attempts", repairs: "Repairs", reviews: "Reviews", humanInterventions: "Human interventions" },
    acceptedFirstPass: "Accepted first pass",
    yes: "Yes",
    no: "No",
  },
  link: {
    kind: { "pull-request": "Pull request", branch: "Branch", commit: "Commit", issue: "Issue", external: "Link" },
    state: { draft: "Draft", open: "Open", merged: "Merged", closed: "Closed" },
  },
  openThread: "Open thread",
  table: {
    name: "Agent tasks table",
    columns: {
      id: "ID",
      title: "Title",
      status: "Status",
      profile: "Profile",
      agent: "Agent",
      attempts: "Attempts",
      cost: "Cost",
      updatedAt: "Updated",
    },
    sortBy: (column) => `Sort by ${column}`,
  },
  components: {},
}

const agentTaskBoardLabelsEs: AgentTaskBoardLabels = {
  board: "Tareas de agentes",
  columns: {
    proposed: "Propuestas",
    todo: "Por hacer",
    working: "En curso",
    review: "En revisión",
    blocked: "Bloqueadas",
    done: "Hechas",
    cancelled: "Canceladas",
  },
  ready: "Listas",
  waiting: "Esperando dependencias",
  filters: {
    group: "Filtros",
    project: "Proyecto",
    allProjects: "Todos los proyectos",
    profile: "Perfil",
    anyProfile: "Cualquier perfil",
    model: "Modelo",
    anyModel: "Cualquier modelo",
    search: "Buscar tareas",
    searchPlaceholder: "Busca por ID, título u objetivo",
    clearSearch: "Borrar búsqueda",
    clear: "Quitar filtros",
    stage: "Etapa",
    noStage: "Sin etapa",
  },
  views: { group: "Vista", board: "Tablero", table: "Tabla", backlog: "Backlog" },
  backlog: { name: "Backlog", proposed: "Propuestas", notReady: "No listas" },
  summary: {
    group: "Resumen",
    total: "Tareas",
    acceptedFirstPass: "Aceptadas a la primera",
    acceptedFirstPassValue: (accepted, rated) => `${accepted} de ${rated}`,
    cost: "Coste estimado",
    awaitingDecision: "Pendientes de decisión",
  },
  moves: {
    group: "Movimientos de tareas",
    handle: (title) => `Mover ${title}`,
    item: "tarea arrastrable",
    instructions:
      "Pulsa Espacio para levantarla. Usa Arriba y Abajo para moverla en la columna, Izquierda y Derecha para cambiar de columna, Espacio para soltarla y Escape para cancelar.",
    message: ({ type, label, list, position, total }) => {
      if (type === "grab") return `${label} levantada. ${list}, posición ${String(position)} de ${String(total)}.`
      if (type === "move") return `${label}: ${list}, posición ${String(position)} de ${String(total)}.`
      if (type === "drop") return `${label} soltada en ${list}, posición ${String(position)} de ${String(total)}.`
      return `Movimiento cancelado. ${label} vuelve a ${list}.`
    },
    agentConfirm: "Mueve una tarea a otra columna, lo que cambia su estado",
  },
  proposals: {
    group: "Decisiones sobre propuestas",
    approve: "Aprobar",
    approveName: (taskId) => `Aprobar propuesta ${taskId}`,
    approving: "Aprobando propuesta",
    reject: "Rechazar",
    rejectName: (taskId) => `Rechazar propuesta ${taskId}`,
    rejectTitle: (taskId) => `¿Rechazar la propuesta ${taskId}?`,
    rejectDescription: "Ningún agente empezará con ella y saldrá del tablero.",
    rejectConfirm: "Descartarla",
    rejecting: "Rechazando propuesta",
    cancel: "Cancelar",
    approveAgentConfirm: (taskId) => `Aprueba la propuesta ${taskId}, lo que pone agentes a trabajar`,
    rejectAgentConfirm: (taskId) => `Rechaza la propuesta ${taskId}`,
    agentConfirm: "Aprueba o rechaza una propuesta de tarea; aprobar pone agentes a trabajar",
  },
  snapshot: (date) => `Instantánea · ${date}`,
  empty: {
    board: "Todavía no hay tareas.",
    column: "Nada por aquí.",
    filtered: "Ninguna tarea coincide con estos filtros.",
    attempts: "Todavía no hay intentos.",
    backlog: "No hay nada en el backlog.",
  },
  errors: {
    approveFailed: "No se pudo aprobar la propuesta.",
    rejectFailed: "No se pudo rechazar la propuesta.",
    unknown: "Algo ha fallado.",
  },
  card: {
    open: (id, title) => `Abrir ${id} ${title}`,
    attempts: (count) => (count === 1 ? "1 intento" : `${count} intentos`),
    cost: "Coste",
    acceptance: (id) => `Aceptación de ${id}`,
    dependencies: (id) => `Dependencias de ${id}`,
    decisionNeeded: "Pendiente de decisión",
    updated: "Actualizada",
    retry: "Reintento",
    analysisMode: {
      review: "Una persona la revisa antes de que trabajen los agentes",
      autonomous: "Los agentes la hacen por su cuenta",
    },
    openPullRequest: (label) => `Abrir pull request ${label}`,
    attachments: (count) => (count === 1 ? "1 adjunto" : `${count} adjuntos`),
  },
  panel: {
    close: "Cerrar detalles de la tarea",
    goal: "Objetivo",
    acceptance: "Aceptación",
    noAcceptance: "Sin criterios de aceptación.",
    dependencies: "Dependencias",
    dependenciesOf: (id) => `Dependencias de ${id}`,
    decision: "Pendiente de decisión",
    usage: "Consumo",
    usageOf: (id) => `Consumo de ${id}`,
    attempts: "Intentos",
    updated: "Actualizada",
    cost: "Coste",
    profile: "Perfil",
    project: "Proyecto",
    status: "Estado",
    labels: "Etiquetas",
    links: "Enlaces",
    linksOf: (id) => `Enlaces de ${id}`,
    activity: "Actividad",
    attachments: "Adjuntos",
    attachmentsOf: (id) => `Adjuntos de ${id}`,
    location: "Ubicación",
    locationOf: (id) => `Etapa de ${id}`,
    attemptsSummary: "Trabajo",
    counts: {
      attempts: "Intentos",
      repairs: "Reparaciones",
      reviews: "Revisiones",
      humanInterventions: "Intervenciones humanas",
    },
    acceptedFirstPass: "Aceptada a la primera",
    yes: "Sí",
    no: "No",
  },
  link: {
    kind: { "pull-request": "Pull request", branch: "Rama", commit: "Commit", issue: "Incidencia", external: "Enlace" },
    state: { draft: "Borrador", open: "Abierta", merged: "Fusionada", closed: "Cerrada" },
  },
  openThread: "Abrir hilo",
  table: {
    name: "Tabla de tareas de agentes",
    columns: {
      id: "ID",
      title: "Título",
      status: "Estado",
      profile: "Perfil",
      agent: "Agente",
      attempts: "Intentos",
      cost: "Coste",
      updatedAt: "Actualizada",
    },
    sortBy: (column) => `Ordenar por ${column}`,
  },
  components: {},
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Merges overrides into `base` two levels deep, so `{ filters: { anyModel } }` keeps the other filter labels. */
function mergeLabels(
  base: AgentTaskBoardLabels,
  ...overrides: (AgentTaskBoardLabelsInput | undefined)[]
): AgentTaskBoardLabels {
  const merged: Record<string, unknown> = { ...base }
  for (const override of overrides) {
    for (const [key, value] of Object.entries(override ?? {})) {
      if (value === undefined) continue
      const current = merged[key]
      merged[key] = isPlainObject(current) && isPlainObject(value) ? { ...current, ...value } : value
    }
  }
  // Every key of `base` is copied before the overrides, each of which replaces a key with its own value or a
  // shallow merge of it; TypeScript can't follow the keys of an interface through `Object.entries`.
  return assumeType<AgentTaskBoardLabels>(merged)
}

export { agentTaskBoardLabels, agentTaskBoardLabelsEs, mergeLabels }
export type {
  MoveLabels,
  TaskMoveMessage,
  AgentTaskBoardComponentLabels,
  AgentTaskBoardLabels,
  AgentTaskBoardLabelsInput,
  CardLabels,
  LinkLabels,
  PanelLabels,
  ProposalLabels,
  TableColumn,
  TableLabels,
}
