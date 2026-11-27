import { afterEach, describe, expect, test } from "bun:test";
import { NfError, boardViews } from "../src/index.ts";
import { addTask, cleanupAll, fixture, passAll, rejection } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

afterEach(cleanupAll);

async function rejects(fn: () => Promise<unknown>, code: string, match?: RegExp): Promise<void> {
  const err = await rejection(fn());
  expect(err).toBeInstanceOf(NfError);
  expect((err as NfError).code).toBe(code);
  if (match) expect((err as NfError).message).toMatch(match);
}

const events = (f: Fixture, key: string) => f.store.listEvents(f.projectId, key);

describe("task brief", () => {
  test("title and goal edits are stored and audited with the old and new value", async () => {
    const f = await fixture();
    const t = await addTask(f, { title: "Old title", goal: "Old goal" });

    const edited = await f.store.editBrief(f.projectId, t.key, {
      title: "New title",
      goal: "New goal",
    });
    expect([edited.title, edited.goal]).toEqual(["New title", "New goal"]);
    expect(edited.updated_at >= t.updated_at).toBe(true);

    const audit = (await events(f, t.key)).filter((e) => e.kind !== "created");
    expect(audit.map((e) => [e.kind, e.actor_role])).toEqual([
      ["update", "coordinator"],
      ["update", "coordinator"],
    ]);
    expect(audit.map((e) => e.note)).toEqual([
      'title: "Old title" -> "New title"',
      'goal: "Old goal" -> "New goal"',
    ]);

    const unchanged = await f.store.editBrief(f.projectId, t.key, { title: "New title" });
    expect(unchanged.title).toBe("New title");
    expect(await events(f, t.key)).toHaveLength(3);
  });

  test("empty values are refused", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { title: "   " }),
      "invalid_value",
      /title/,
    );
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { goal: "" }),
      "invalid_value",
      /goal/,
    );
  });

  test("a replaced acceptance list keeps unchanged items and resets the rest", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["first", "second"] });
    await f.store.checkItem(f.projectId, t.key, 1, "pass", "ran it");
    await f.store.checkItem(f.projectId, t.key, 2, "fail", "broken");

    const edited = await f.store.editBrief(f.projectId, t.key, {
      acceptance: ["first", "rewritten", "third"],
    });
    expect(edited.acceptance).toEqual([
      { position: 1, text: "first", result: "pass", evidence: "ran it" },
      { position: 2, text: "rewritten", result: "unverified", evidence: null },
      { position: 3, text: "third", result: "unverified", evidence: null },
    ]);

    const acceptance = (await events(f, t.key)).filter((e) => e.kind === "acceptance");
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0]?.note).toBe(
      'acceptance: ["first","second"] -> ["first","rewritten","third"]',
    );
  });

  test("added items start unverified, removed items disappear, positions close up", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["a", "b", "c"] });
    await passAll(f, t.key);

    const added = await f.store.editBrief(f.projectId, t.key, { addAcceptance: ["d"] });
    expect(added.acceptance.map((item) => [item.position, item.text, item.result])).toEqual([
      [1, "a", "pass"],
      [2, "b", "pass"],
      [3, "c", "pass"],
      [4, "d", "unverified"],
    ]);

    const removed = await f.store.editBrief(f.projectId, t.key, { removeAcceptance: [2] });
    expect(removed.acceptance.map((item) => [item.position, item.text, item.result])).toEqual([
      [1, "a", "pass"],
      [2, "c", "pass"],
      [3, "d", "unverified"],
    ]);
    expect(removed.acceptance[0]?.evidence).toBe("ok");

    const acceptance = (await events(f, t.key)).filter((e) => e.kind === "acceptance");
    expect(acceptance.map((e) => e.note)).toEqual([
      'acceptance: ["a","b","c"] -> ["a","b","c","d"]',
      'acceptance: ["a","b","c","d"] -> ["a","c","d"]',
    ]);
  });

  test("removing an item that does not exist is a clear error", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["one"] });
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { removeAcceptance: [4] }),
      "not_found",
      /T-001 has no acceptance item #4/,
    );
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { removeAcceptance: [0] }),
      "not_found",
      /#0/,
    );
    expect((await f.store.getTask(f.projectId, t.key)).acceptance).toHaveLength(1);
  });

  test("acceptance must keep at least one item", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["one"] });
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { acceptance: [] }),
      "invalid_value",
      /at least one/,
    );
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { removeAcceptance: [1] }),
      "invalid_value",
      /at least one/,
    );
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { addAcceptance: ["  "] }),
      "invalid_value",
      /acceptance item/,
    );
  });

  test("a done task's brief is frozen until its caller reopens it", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["one"] });
    await passAll(f, t.key);
    await f.store.setStatus(f.projectId, t.key, "working");
    await f.store.setStatus(f.projectId, t.key, "review");
    await f.store.acceptTask(f.projectId, t.key);

    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { title: "changed" }),
      "illegal_transition",
      /T-001 is done; pass --reopen to edit its title, goal or acceptance/,
    );
    await rejects(
      () => f.store.editBrief(f.projectId, t.key, { addAcceptance: ["two"] }),
      "illegal_transition",
    );

    const reopened = await f.store.editBrief(
      f.projectId,
      t.key,
      { title: "changed", addAcceptance: ["two"] },
      { allowClosed: true },
    );
    expect(reopened.title).toBe("changed");
    expect(reopened.acceptance.map((item) => item.result)).toEqual(["pass", "unverified"]);

    const cancelled = await addTask(f, { acceptance: ["one"] });
    await f.store.setStatus(f.projectId, cancelled.key, "cancelled");
    await rejects(
      () => f.store.editBrief(f.projectId, cancelled.key, { goal: "changed" }),
      "illegal_transition",
      /is cancelled; pass --reopen/,
    );
  });

  test("the board view carries the edited brief", async () => {
    const f = await fixture();
    const t = await addTask(f, { title: "Old title", goal: "Old goal", acceptance: ["one"] });
    await f.store.editBrief(f.projectId, t.key, {
      title: "New title",
      goal: "New goal",
      acceptance: ["one", "two"],
    });
    const [view] = await f.run(boardViews(f.projectId, "2026-01-01T00:00:00.000Z"));
    expect(view).toMatchObject({
      title: "New title",
      goal: "New goal",
      acceptance: [
        { text: "one", result: "unverified" },
        { text: "two", result: "unverified" },
      ],
    });
  });
});
