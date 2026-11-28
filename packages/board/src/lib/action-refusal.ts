type ActionCall = { reason?: string; event?: Event | undefined } | undefined

/** Why an action didn't run: the app's callback refused it, or the component's state doesn't offer it now. */
type ActionRefusalKind = "refused" | "unavailable"

/** What `parseActionRefusal` reads back from a failed step: the action, why, and the sentence without its tag. */
type ActionRefusal = { action: string; kind: ActionRefusalKind; text: string }

// Workaround: UI SDK's bridge (0.1.0-beta.12) keeps only `error.message` in a failed step, locally and over WebMCP, so the
// identity travels as a tag at the end of the message, where the bridge's own prefix for a rejected promise can't
// displace it.
const refusalTag = /\s*\[(refused|unavailable):([^\]\s]+)\]\s*$/

const tagged = (text: string, kind: ActionRefusalKind, action: string) => `${text} [${kind}:${action}]`

/**
 * Thrown by a component's action that was called with no press behind it (an agent's step, a controller, app code)
 * and didn't run. UI SDK's bridge reports `ok: true` for any action that returns, so a throw is what fails the
 * agent's step with `message`, which ends with `[refused:start]` or `[unavailable:start]` for `parseActionRefusal`.
 */
class ActionRefusedError extends Error {
  override name = "ActionRefusedError"
  readonly action: string
  readonly kind: ActionRefusalKind
  /** The sentence for people, without the tag: `start was refused by the app.` */
  readonly text: string

  constructor(action: string, kind: ActionRefusalKind, text: string) {
    super(tagged(text, kind, action))
    this.action = action
    this.kind = kind
    this.text = text
  }
}

/**
 * Tells an `ActionRefusedError` from any other failure where only its message survived: an agent step's
 * `result.error` (from `agent.act()` or the WebMCP `act` tool), its `message`, or the error itself. Returns `null`
 * for anything else, a redacted step included.
 */
function parseActionRefusal(failure: unknown): ActionRefusal | null {
  if (failure instanceof ActionRefusedError) return { action: failure.action, kind: failure.kind, text: failure.text }
  const message =
    typeof failure === "string"
      ? failure
      : typeof failure === "object" && failure !== null && "message" in failure && typeof failure.message === "string"
        ? failure.message
        : undefined
  const match = message === undefined ? null : refusalTag.exec(message)
  if (!match || message === undefined) return null
  return {
    action: match[2] ?? "",
    kind: match[1] === "refused" ? "refused" : "unavailable",
    text: message.slice(0, match.index),
  }
}

const isImperative = (call: ActionCall) => !call?.event && (call?.reason ?? "imperative") === "imperative"

/**
 * An action that can't run: returns `false` for a person's press, which the interface didn't offer anyway, and throws
 * for any other call. `why` finishes the sentence after the action's name: `isn't available while listening`.
 */
function unavailable(action: string, why: string): never
function unavailable(action: string, why: string, call: ActionCall): false
function unavailable(action: string, why: string, call?: ActionCall): false {
  if (isImperative(call)) throw new ActionRefusedError(action, "unavailable", `${action} ${why}.`)
  return false
}

/**
 * Settles what `createChange` or `!dispatch(...)` returned: `true` stays, and a change the app cancelled through
 * `details.cancel()` returns `false` for a person's press and throws for any other call.
 */
function settled<Result>(result: Result | false, action: string): Result
function settled<Result>(result: Result | false, action: string, call: ActionCall): Result | false
function settled<Result>(result: Result | false, action: string, call?: ActionCall): Result | false {
  if (result !== false) return result
  if (isImperative(call)) throw new ActionRefusedError(action, "refused", `${action} was refused by the app.`)
  return false
}

export { ActionRefusedError, parseActionRefusal, settled, unavailable }
export type { ActionCall, ActionRefusal, ActionRefusalKind }
