import * as Effect from "effect/Effect";

/**
 * One answer per key for the lifetime of this memo: the first caller computes, callers that arrive
 * while it runs share that run, and later callers reuse the value. Each memo belongs to one build
 * or one cache generation, so a caller that needs fresher answers starts a new one.
 */
export interface EffectMemo<A> {
  read(key: string, compute: () => Effect.Effect<A>): Effect.Effect<A>;
}

export const effectMemo = <A>(): EffectMemo<A> => {
  const cells = new Map<string, Effect.Effect<A>>();
  return {
    read: Effect.fnUntraced(function* (key: string, compute: () => Effect.Effect<A>) {
      const known = cells.get(key);
      if (known !== undefined) return yield* known;
      const cell = yield* Effect.cached(compute());
      cells.set(key, cell);
      return yield* cell;
    }),
  };
};
