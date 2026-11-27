// The NF adapter emits the `@nf/contracts` view types; the board consumes the Eskais UI types.
// These assertions fail the type check if the two drift apart, in either direction.
import type { AttemptView as NfAttemptView, TaskView as NfTaskView } from "@nf/contracts";
import type { AttemptView, TaskView } from "@/lib/agent-task-types";

/** The JSON in a snapshot drops `readonly`; the board's props take mutable arrays. */
export type Writable<T> = T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T;

type Assignable<From, To> = [From] extends [To] ? true : false;
type Expect<T extends true> = T;

export type NfTaskViewFitsBoard = Expect<Assignable<Writable<NfTaskView>, TaskView>>;
export type BoardTaskViewFitsNf = Expect<Assignable<TaskView, NfTaskView>>;
export type NfAttemptViewFitsBoard = Expect<Assignable<Writable<NfAttemptView>, AttemptView>>;
export type BoardAttemptViewFitsNf = Expect<Assignable<AttemptView, NfAttemptView>>;
