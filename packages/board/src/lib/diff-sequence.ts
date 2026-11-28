type SequenceAlgorithm = "histogram" | "myers"

type SequenceDiff = {
  /**
   * Matches `a` against `b`, sequences of ids where equal ids are equal elements. Returns, for each index of `a`,
   * the index of `b` it matches, or -1 when it was removed. Matches only ever increase.
   */
  match: (a: Int32Array, b: Int32Array, algorithm?: SequenceAlgorithm, maxCost?: number) => Int32Array
}

// oxlint-disable unicorn/consistent-function-scoping -- a Web Worker runs the factory below from its source, so every helper lives inside it
/**
 * The sequence diff, written as one self-contained function so a Web Worker can be built from its source
 * (`String(createSequenceDiff)`): it must not reference anything outside its body.
 */
function createSequenceDiff(): SequenceDiff {
  const FAR = 0x7f_ff_ff_ff
  // Spec: git's histogram ignores lines this common as anchors.
  const MAX_CHAIN = 64
  const scratch = { fd: new Int32Array(0), bd: new Int32Array(0) }

  function costFor(n: number, m: number, maxCost?: number) {
    if (maxCost !== undefined) return Math.max(1, maxCost)
    return Math.max(1024, Math.floor(Math.sqrt(n + m)) * 16)
  }

  // Perf: linear-space Myers (the middle-snake split of "An O(ND) Difference Algorithm", as GNU diff writes it):
  // past `tooExpensive` edit steps it takes the furthest-reaching diagonal instead of the middle snake.
  function myersRegion(
    a: Int32Array,
    b: Int32Array,
    out: Int32Array,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    tooExpensive: number,
  ) {
    const offset = b.length + 1
    const size = a.length + b.length + 3
    if (scratch.fd.length < size) {
      scratch.fd = new Int32Array(size)
      scratch.bd = new Int32Array(size)
    }
    const { fd, bd } = scratch
    const stack = [x0, x1, y0, y1]
    while (stack.length > 0) {
      let ylim = stack.pop()!
      let yoff = stack.pop()!
      let xlim = stack.pop()!
      let xoff = stack.pop()!
      while (xoff < xlim && yoff < ylim && a[xoff] === b[yoff]) {
        out[xoff] = yoff
        xoff++
        yoff++
      }
      while (xlim > xoff && ylim > yoff && a[xlim - 1] === b[ylim - 1]) {
        xlim--
        ylim--
        out[xlim] = ylim
      }
      if (xoff === xlim || yoff === ylim) continue
      const dmin = xoff - ylim
      const dmax = xlim - yoff
      const fmid = xoff - yoff
      const bmid = xlim - ylim
      let fmin = fmid
      let fmax = fmid
      let bmin = bmid
      let bmax = bmid
      const odd = ((fmid - bmid) & 1) !== 0
      fd[fmid + offset] = xoff
      bd[bmid + offset] = xlim
      let xmid = -1
      let ymid = -1
      for (let cost = 1; xmid < 0; cost++) {
        if (fmin > dmin) fd[--fmin - 1 + offset] = -1
        else ++fmin
        if (fmax < dmax) fd[++fmax + 1 + offset] = -1
        else --fmax
        for (let d = fmax; d >= fmin; d -= 2) {
          const tlo = fd[d - 1 + offset]!
          const thi = fd[d + 1 + offset]!
          let x = tlo < thi ? thi : tlo + 1
          let y = x - d
          while (x < xlim && y < ylim && a[x] === b[y]) {
            x++
            y++
          }
          fd[d + offset] = x
          if (odd && bmin <= d && d <= bmax && bd[d + offset]! <= x) {
            xmid = x
            ymid = y
            break
          }
        }
        if (xmid >= 0) break
        if (bmin > dmin) bd[--bmin - 1 + offset] = FAR
        else ++bmin
        if (bmax < dmax) bd[++bmax + 1 + offset] = FAR
        else --bmax
        for (let d = bmax; d >= bmin; d -= 2) {
          const tlo = bd[d - 1 + offset]!
          const thi = bd[d + 1 + offset]!
          let x = tlo < thi ? tlo : thi - 1
          let y = x - d
          while (xoff < x && yoff < y && a[x - 1] === b[y - 1]) {
            x--
            y--
          }
          bd[d + offset] = x
          if (!odd && fmin <= d && d <= fmax && x <= fd[d + offset]!) {
            xmid = x
            ymid = y
            break
          }
        }
        if (xmid >= 0 || cost < tooExpensive) continue
        let fxybest = -1
        let fxbest = xoff
        for (let d = fmax; d >= fmin; d -= 2) {
          let x = Math.min(fd[d + offset]!, xlim)
          let y = x - d
          if (ylim < y) {
            x = ylim + d
            y = ylim
          }
          if (fxybest < x + y) {
            fxybest = x + y
            fxbest = x
          }
        }
        let bxybest = FAR
        let bxbest = xlim
        for (let d = bmax; d >= bmin; d -= 2) {
          let x = Math.max(xoff, bd[d + offset]!)
          let y = x - d
          if (y < yoff) {
            x = yoff + d
            y = yoff
          }
          if (x + y < bxybest) {
            bxybest = x + y
            bxbest = x
          }
        }
        if (xlim + ylim - bxybest < fxybest - (xoff + yoff)) {
          xmid = fxbest
          ymid = fxybest - fxbest
        } else {
          xmid = bxbest
          ymid = bxybest - bxbest
        }
      }
      stack.push(xmid, xlim, ymid, ylim, xoff, xmid, yoff, ymid)
    }
  }

  // Perf: elements found on one side only can never match, so Myers runs on the rest (GNU diff's
  // discard_confusing_lines, without its heuristics).
  function myers(a: Int32Array, b: Int32Array, out: Int32Array, maxCost?: number) {
    let max = 0
    for (const id of a) if (id > max) max = id
    for (const id of b) if (id > max) max = id
    const inA = new Uint8Array(max + 1)
    const inB = new Uint8Array(max + 1)
    for (const id of a) inA[id] = 1
    for (const id of b) inB[id] = 1
    const keepA: number[] = []
    const keepB: number[] = []
    for (let i = 0; i < a.length; i++) if (inB[a[i]!]) keepA.push(i)
    for (let j = 0; j < b.length; j++) if (inA[b[j]!]) keepB.push(j)
    const ca = Int32Array.from(keepA, (i) => a[i]!)
    const cb = Int32Array.from(keepB, (j) => b[j]!)
    const inner = new Int32Array(ca.length).fill(-1)
    myersRegion(ca, cb, inner, 0, ca.length, 0, cb.length, costFor(ca.length, cb.length, maxCost))
    for (let i = 0; i < inner.length; i++) if (inner[i]! >= 0) out[keepA[i]!] = keepB[inner[i]!]!
  }

  function histogram(a: Int32Array, b: Int32Array, out: Int32Array, maxCost?: number) {
    const tooExpensive = costFor(a.length, b.length, maxCost)
    const counts = new Map<number, number[]>()
    const stack = [0, a.length, 0, b.length]
    while (stack.length > 0) {
      let bHi = stack.pop()!
      let bLo = stack.pop()!
      let aHi = stack.pop()!
      let aLo = stack.pop()!
      while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out[aLo++] = bLo++
      while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) out[--aHi] = --bHi
      if (aLo === aHi || bLo === bHi) continue
      counts.clear()
      for (let i = aLo; i < aHi; i++) {
        const positions = counts.get(a[i]!)
        if (positions) positions.push(i)
        else counts.set(a[i]!, [i])
      }
      let bestCount = MAX_CHAIN + 1
      let bestLength = 0
      let as = -1
      let ae = -1
      let bs = -1
      for (let j = bLo; j < bHi; j++) {
        const positions = counts.get(b[j]!)
        if (!positions || positions.length > bestCount) continue
        let nextJ = j
        for (const i of positions) {
          let s = i
          let t = j
          let low = positions.length
          while (s > aLo && t > bLo && a[s - 1] === b[t - 1]) {
            s--
            t--
            low = Math.min(low, counts.get(a[s]!)!.length)
          }
          let e = i + 1
          let f = j + 1
          while (e < aHi && f < bHi && a[e] === b[f]) {
            low = Math.min(low, counts.get(a[e]!)!.length)
            e++
            f++
          }
          if (low < bestCount || (low === bestCount && e - s > bestLength)) {
            bestCount = low
            bestLength = e - s
            as = s
            ae = e
            bs = t
          }
          if (f - 1 > nextJ) nextJ = f - 1
        }
        j = nextJ
      }
      if (as < 0) {
        myersRegion(a, b, out, aLo, aHi, bLo, bHi, tooExpensive)
        continue
      }
      for (let i = as; i < ae; i++) out[i] = bs + (i - as)
      stack.push(ae, aHi, bs + (ae - as), bHi, aLo, as, bLo, bs)
    }
  }

  return {
    match(a, b, algorithm = "histogram", maxCost) {
      const out = new Int32Array(a.length).fill(-1)
      if (a.length === 0 || b.length === 0) return out
      if (algorithm === "myers") myers(a, b, out, maxCost)
      else histogram(a, b, out, maxCost)
      return out
    },
  }
}

const sequenceDiff = createSequenceDiff()

export { createSequenceDiff, sequenceDiff }
export type { SequenceAlgorithm, SequenceDiff }
