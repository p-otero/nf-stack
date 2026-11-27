import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { MAX_ATTACHMENT_BYTES, attachArtifact, boardViews } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { addTask, cleanupAll, fixture, passAll, rejection, startImpl, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);
const PNG_DARK = Buffer.concat([PNG, Buffer.from("dark")]);
const AT = "2026-01-01T12:00:00.000Z";

function writeFile(name: string, bytes: Buffer): string {
  const file = join(tempDir("nf-artifact-"), name);
  writeFileSync(file, bytes);
  return file;
}

function attach(
  f: Fixture,
  attemptKey: string,
  file: string,
  over: Record<string, string | undefined> = {},
) {
  return f.run(
    attachArtifact(f.projectId, attemptKey, {
      home: f.home,
      file,
      kind: "screenshot",
      theme: "light",
      name: "checkout",
      ...over,
    }),
  );
}

async function uiTask(f: Fixture) {
  const task = await addTask(f, { ui: true });
  const attempt = await startImpl(f, task.key);
  return { task, attempt };
}

describe("ui flag", () => {
  test("is stored on add, changes on update and reaches the board as a UI label", async () => {
    const f = await fixture();
    const flagged = await addTask(f, { ui: true });
    expect(flagged.ui).toBe(true);
    expect((await f.store.getTask(f.projectId, flagged.key)).ui).toBe(true);

    const plain = await addTask(f, { title: "plain" });
    expect(plain.ui).toBe(false);
    expect((await f.store.updateTask(f.projectId, flagged.key, { ui: false })).ui).toBe(false);
    expect((await f.store.updateTask(f.projectId, plain.key, { ui: true })).ui).toBe(true);

    const views = await f.run(boardViews(f.projectId, AT));
    const byId = new Map(views.map((view) => [view.id, view]));
    expect(byId.get(flagged.key)?.labels).toBeUndefined();
    expect(byId.get(plain.key)?.labels).toEqual(["UI"]);
  });
});

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  return (await rejection(promise)).message;
}

describe("attempt attachments", () => {
  test("copies the file under NF_HOME with a content-hashed name and records a row and an event", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);
    const file = writeFile("light.png", PNG);
    const attachment = await attach(f, attempt.key, file);

    const expectedDir = join(f.home, "artifacts", "demo", attempt.task_key, attempt.key);
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    expect(attachment).toMatchObject({
      attempt_key: attempt.key,
      kind: "screenshot",
      theme: "light",
      name: "checkout",
      bytes: PNG.byteLength,
      sha256,
    });
    expect(attachment.path.startsWith(expectedDir)).toBe(true);
    expect(basename(attachment.path)).toBe(`checkout-${sha256.slice(0, 12)}.png`);
    expect(existsSync(attachment.path)).toBe(true);
    expect(readFileSync(attachment.path).equals(PNG)).toBe(true);

    const listed = await f.store.listAttachments(f.projectId, attempt.key);
    expect(listed.map((item) => item.id)).toEqual([attachment.id]);
    const events = await f.store.listEvents(f.projectId, attempt.task_key);
    expect(events.filter((event) => event.kind === "attachment")).toHaveLength(1);

    const again = await attach(f, attempt.key, file);
    expect(again.id).toBe(attachment.id);
    expect(await f.store.listAttachments(f.projectId, attempt.key)).toHaveLength(1);

    await attach(f, attempt.key, writeFile("dark.png", PNG_DARK), { theme: "dark" });
    expect(await f.store.listAttachments(f.projectId, attempt.key)).toHaveLength(2);
  });

  test("refuses oversized files and non-media screenshots or recordings", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);

    expect(
      await rejectionMessage(attach(f, attempt.key, writeFile("notes.txt", Buffer.from("hi")))),
    ).toMatch(/needs an image/);
    expect(
      await rejectionMessage(
        attach(f, attempt.key, writeFile("clip.png", PNG), { kind: "recording", name: "clip" }),
      ),
    ).toMatch(/needs a video/);
    expect(
      await rejectionMessage(
        attach(f, attempt.key, writeFile("unthemed.png", PNG), { theme: undefined }),
      ),
    ).toMatch(/--theme light\|dark/);
    expect(
      await rejectionMessage(
        attach(f, attempt.key, writeFile("huge.png", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))),
      ),
    ).toMatch(/capped at 15\.0 MB/);
    expect(await f.store.listAttachments(f.projectId, attempt.key)).toEqual([]);
  });

  test("the board pairs light and dark screenshots and links the full-size files", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);
    const light = await attach(f, attempt.key, writeFile("light.png", PNG));
    await attach(f, attempt.key, writeFile("dark.png", PNG_DARK), { theme: "dark" });
    const recording = await attach(f, attempt.key, writeFile("flow.webm", Buffer.from("webm")), {
      kind: "recording",
      theme: undefined,
      name: "flow",
    });

    const [view] = (await f.run(boardViews(f.projectId, AT))).map((task) => task.attachments);
    expect(view).toHaveLength(2);
    expect(view?.[0]).toMatchObject({
      id: light.id,
      name: "checkout",
      kind: "image",
      alt: "checkout",
      src: expect.stringMatching(/^file:\/\//),
      srcDark: expect.stringMatching(/^file:\/\//),
      thumbnail: expect.stringMatching(/^data:image\/jpeg;base64,/),
      thumbnailDark: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(view?.[0]?.href).toStartWith("file://");
    expect(view?.[1]).toMatchObject({
      id: recording.id,
      name: "flow",
      kind: "file",
      src: expect.stringMatching(/^file:\/\//),
      href: expect.stringMatching(/^file:\/\//),
    });
  });

  test("a screenshot whose file is gone becomes a file placeholder with its name", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);
    await attach(f, attempt.key, writeFile("light.png", PNG));
    await attach(f, attempt.key, writeFile("dark.png", PNG_DARK), { theme: "dark" });
    const rows = await f.store.listAttachments(f.projectId, attempt.key);
    const dark = rows.find((row) => row.theme === "dark");
    rmSync(dark?.path ?? "", { force: true });

    const [partial] = (await f.run(boardViews(f.projectId, AT))).map((task) => task.attachments);
    expect(partial?.[0]).toMatchObject({ name: "checkout", kind: "image" });
    expect(partial?.[0]?.srcDark).toBeUndefined();

    rmSync(rows.find((row) => row.theme === "light")?.path ?? "", { force: true });
    for (const options of [{}, { artifactBase: "/artifacts" }]) {
      const [view] = (await f.run(boardViews(f.projectId, AT, options))).map(
        (task) => task.attachments,
      );
      expect(view?.[0]).toMatchObject({ name: "checkout", kind: "file", alt: "checkout" });
      expect(view?.[0]?.href).toBeUndefined();
    }
  });

  test("a snapshot embeds a 320 px JPEG thumbnail and links the full-size screenshot", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);
    const wide = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#3366cc" },
    })
      .png()
      .toBuffer();
    await attach(f, attempt.key, writeFile("wide.png", wide), { name: "wide" });

    const [view] = (await f.run(boardViews(f.projectId, AT))).map((task) => task.attachments);
    const thumbnail = view?.[0]?.thumbnail ?? "";
    expect(view?.[0]?.kind).toBe("image");
    expect(view?.[0]?.src).toStartWith("file://");
    expect(thumbnail).toStartWith("data:image/jpeg;base64,");
    const bytes = Buffer.from(thumbnail.split(",")[1] ?? "", "base64");
    expect(bytes.byteLength).toBeLessThan(wide.byteLength / 8);
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(320);
  });

  test("an undecodable screenshot keeps its file link and no thumbnail", async () => {
    const f = await fixture();
    const { attempt } = await uiTask(f);
    const broken = Buffer.from("not a png at all");
    await attach(f, attempt.key, writeFile("broken.png", broken), { name: "broken" });

    const [task] = await f.run(boardViews(f.projectId, AT));
    expect(task?.attachments?.[0]?.kind).toBe("image");
    expect(task?.attachments?.[0]?.thumbnail).toBeUndefined();
    expect(task?.attachments?.[0]?.src).toStartWith("file://");
  });
});

describe("accepting a ui task", () => {
  test("needs the user's approval and a light and a dark screenshot on the accepted attempt", async () => {
    const f = await fixture();
    const { task, attempt } = await uiTask(f);
    await passAll(f, task.key);
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded" });
    await f.store.setStatus(f.projectId, task.key, "working");
    await f.store.setStatus(f.projectId, task.key, "review");

    expect(await rejectionMessage(f.store.acceptTask(f.projectId, task.key))).toMatch(
      /light screenshot.*dark screenshot.*--approved-by-user/,
    );
    await attach(f, attempt.key, writeFile("light.png", PNG));
    expect(
      await rejectionMessage(f.store.acceptTask(f.projectId, task.key, { approvedByUser: true })),
    ).toMatch(/dark screenshot/);
    await attach(f, attempt.key, writeFile("dark.png", PNG_DARK), { theme: "dark" });
    expect(await rejectionMessage(f.store.acceptTask(f.projectId, task.key))).toMatch(
      /--approved-by-user/,
    );

    const done = await f.store.acceptTask(f.projectId, task.key, { approvedByUser: true });
    expect(done.status).toBe("done");
  });

  test("a task without the flag still accepts without screenshots or approval", async () => {
    const f = await fixture();
    const task = await addTask(f);
    await passAll(f, task.key);
    await f.store.setStatus(f.projectId, task.key, "working");
    await f.store.setStatus(f.projectId, task.key, "review");
    expect((await f.store.acceptTask(f.projectId, task.key)).status).toBe("done");
  });

  test("no attempt at all says an attempt with evidence is missing", async () => {
    const f = await fixture();
    const task = await addTask(f, { ui: true });
    await passAll(f, task.key);
    await f.store.setStatus(f.projectId, task.key, "working");
    await f.store.setStatus(f.projectId, task.key, "review");
    const error = await rejection(f.store.acceptTask(f.projectId, task.key));
    expect(error.message).toContain("an attempt with a screenshot per project theme (light, dark)");
    expect(error.message).toContain("--approved-by-user");
  });

  test("a project with only the light theme needs one light screenshot", async () => {
    const f = await fixture();
    mkdirSync(join(f.home, "projects"), { recursive: true });
    writeFileSync(join(f.home, "projects", "T.yaml"), "ui: { themes: [light] }\n", "utf8");
    const { task, attempt } = await uiTask(f);
    await passAll(f, task.key);
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded" });
    await f.store.setStatus(f.projectId, task.key, "working");
    await f.store.setStatus(f.projectId, task.key, "review");

    expect(
      await rejectionMessage(
        f.store.acceptTask(f.projectId, task.key, { approvedByUser: true, themes: ["light"] }),
      ),
    ).toMatch(/a light screenshot on .*--theme light/);
    await attach(f, attempt.key, writeFile("light.png", PNG));
    const done = await f.store.acceptTask(f.projectId, task.key, {
      approvedByUser: true,
      themes: ["light"],
    });
    expect(done.status).toBe("done");
  });

  test("attach refuses a theme the project does not declare", async () => {
    const f = await fixture();
    mkdirSync(join(f.home, "projects"), { recursive: true });
    writeFileSync(join(f.home, "projects", "T.yaml"), "ui: { themes: [light] }\n", "utf8");
    const { attempt } = await uiTask(f);
    expect(
      await rejectionMessage(
        attach(f, attempt.key, writeFile("dark.png", PNG_DARK), { theme: "dark" }),
      ),
    ).toMatch(/--theme dark is not declared for this project \(ui\.themes: light\)/);
    expect(await f.store.listAttachments(f.projectId, attempt.key)).toEqual([]);
  });
});
