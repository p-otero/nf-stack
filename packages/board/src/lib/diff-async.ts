import { createLineDiff, diffText } from "@/lib/diff-lines"
import { createSequenceDiff } from "@/lib/diff-sequence"
import type { DiffOptions, TextDiff } from "@/lib/diff-types"

type AsyncDiffOptions = DiffOptions & {
  signal?: AbortSignal
  /**
   * `"auto"` (default) diffs in a Web Worker when the two texts together pass `workerThreshold` characters,
   * `true` always does where workers exist, `false` never does.
   */
  worker?: boolean | "auto"
  /** @defaultValue 200000 */
  workerThreshold?: number
}

type Pending = { resolve: (diff: TextDiff) => void; reject: (error: unknown) => void }

const WORKER_THRESHOLD = 200_000

let worker: Worker | null = null
let broken = false
let nextId = 0
const pending = new Map<number, Pending>()

// Workaround: shadcn copies registry files into a consumer's folders, where `new URL("./x.worker.ts",
// import.meta.url)` resolves only under bundlers that compile it, so the worker is built from the engine's source
// in a Blob. `__name` covers esbuild's keepNames helper.
function workerSource() {
  return [
    '"use strict";',
    "var __name = function (target) { return target };",
    `var sequence = (${String(createSequenceDiff)})();`,
    `var lines = (${String(createLineDiff)})(sequence);`,
    "self.onmessage = function (event) {",
    "  var data = event.data;",
    "  try { self.postMessage({ id: data.id, result: lines.diffText(data.oldText, data.newText, data.options) }) }",
    "  catch (error) { self.postMessage({ id: data.id, error: String((error && error.message) || error) }) }",
    "};",
  ].join("\n")
}

function failAll(error: unknown) {
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
}

function stopWorker() {
  worker?.terminate()
  worker = null
}

function getWorker() {
  if (worker || broken) return worker
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
    broken = true
    return null
  }
  try {
    const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
  } catch {
    // Security: a Content Security Policy without `worker-src blob:` refuses it.
    broken = true
    return null
  }
  worker.addEventListener("message", (event: MessageEvent<{ id: number; result?: TextDiff; error?: string }>) => {
    const entry = pending.get(event.data.id)
    if (!entry) return
    pending.delete(event.data.id)
    if (event.data.result) entry.resolve(event.data.result)
    else entry.reject(new Error(event.data.error ?? "Diff failed"))
  })
  worker.addEventListener("error", (event) => {
    event.preventDefault()
    broken = true
    stopWorker()
    failAll(new Error("The diff worker failed to start"))
  })
  return worker
}

function abortError() {
  return new DOMException("The diff was aborted", "AbortError")
}

function shouldUseWorker(oldText: string, newText: string, options: AsyncDiffOptions) {
  const { worker: mode = "auto", workerThreshold = WORKER_THRESHOLD } = options
  if (mode === false) return false
  return mode === true || oldText.length + newText.length > workerThreshold
}

function viaWorker(target: Worker, oldText: string, newText: string, options: AsyncDiffOptions) {
  const { signal, worker: _mode, workerThreshold: _threshold, ...diffOptions } = options
  const id = nextId++
  return new Promise<TextDiff>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.delete(id)) return
      // Spec: a worker can't stop mid-diff.
      stopWorker()
      failAll(abortError())
      reject(abortError())
    }
    pending.set(id, {
      resolve: (diff) => {
        signal?.removeEventListener("abort", onAbort)
        resolve(diff)
      },
      reject: (error) => {
        signal?.removeEventListener("abort", onAbort)
        reject(error)
      },
    })
    signal?.addEventListener("abort", onAbort, { once: true })
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage takes no origin
    target.postMessage({ id, oldText, newText, options: diffOptions })
  })
}

/**
 * `diffText` that runs in a Web Worker past `workerThreshold` characters, so a 20,000-line file doesn't block
 * typing or scrolling, and on the main thread below it, without workers (server, tests) or when a Content
 * Security Policy blocks a `blob:` worker. Rejects with an `AbortError` when `signal` aborts.
 */
async function diffTextAsync(oldText: string, newText: string, options: AsyncDiffOptions = {}): Promise<TextDiff> {
  if (options.signal?.aborted) throw abortError()
  const target = shouldUseWorker(oldText, newText, options) ? getWorker() : null
  if (target) {
    try {
      return await viaWorker(target, oldText, newText, options)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error
      if (!broken) throw error
    }
  }
  const { signal: _signal, worker: _mode, workerThreshold: _threshold, ...diffOptions } = options
  return diffText(oldText, newText, diffOptions)
}

/** Whether `diffTextAsync` would use a worker for these texts, for a caller that diffs small inputs during render. */
function diffsInWorker(oldText: string, newText: string, options: AsyncDiffOptions = {}) {
  return shouldUseWorker(oldText, newText, options) && !broken && typeof Worker !== "undefined"
}

export { diffsInWorker, diffTextAsync, WORKER_THRESHOLD }
export type { AsyncDiffOptions }
