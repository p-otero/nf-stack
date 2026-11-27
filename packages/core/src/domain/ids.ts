import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

let lastTime = -1;
let lastRandom = new Uint8Array(10);

function encodeTime(ms: number): string {
  let out = "";
  let n = ms;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // 80 bits -> 16 base32 chars
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

/** Monotonic ULID: 26 chars, sortable by creation time. */
export function ulid(nowMs: number = Date.now()): string {
  if (nowMs <= lastTime) {
    // same millisecond (or clock went back): increment the previous random part
    nowMs = lastTime;
    for (let i = 9; i >= 0; i--) {
      if (lastRandom[i] === 255) {
        lastRandom[i] = 0;
      } else {
        lastRandom[i] = (lastRandom[i] ?? 0) + 1;
        break;
      }
    }
  } else {
    lastTime = nowMs;
    lastRandom = new Uint8Array(randomBytes(10));
  }
  return encodeTime(nowMs) + encodeRandom(lastRandom);
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/** Machine id: a ULID stored once in `<home>/machine-id`. */
export function machineId(home: string): string {
  const file = join(home, "machine-id");
  const read = (): string | null => {
    try {
      const v = readFileSync(file, "utf8").trim();
      return isUlid(v) ? v : null;
    } catch {
      return null;
    }
  };
  const existing = read();
  if (existing) return existing;
  mkdirSync(home, { recursive: true });
  const fresh = ulid();
  try {
    writeFileSync(file, fresh + "\n", { flag: "wx" });
    return fresh;
  } catch {
    // lost a creation race: use the winner's value
    return read() ?? fresh;
  }
}
