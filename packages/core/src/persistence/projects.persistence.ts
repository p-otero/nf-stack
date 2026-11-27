import { basename } from "node:path";
import * as Effect from "effect/Effect";
import type { Project } from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { normalizePrefix, uniqueProjectPrefix } from "../domain/keys.ts";
import { optText } from "../domain/validate.ts";
import { normalizePath, pathKey } from "../system/git.ts";
import { rewriteProjectKeys } from "./project-prefix.persistence.ts";
import {
  decodeProject,
  decodeProjectIdentity,
  decodeProjectPrefix,
  fail,
  one,
  type StoreContext,
} from "./store-rows.ts";

export interface RegisterProjectInput {
  name?: string | undefined;
  /** Explicit prefix; derived from the name when absent. */
  prefix?: string | null | undefined;
  rootPath: string;
  remoteUrl?: string | null | undefined;
  coordinatorEnvironmentId?: string | null | undefined;
  coordinatorThreadId?: string | null | undefined;
  coordinatorThreadLink?: string | null | undefined;
}

export const projectStore = (ctx: StoreContext) => {
  const { sql, machine, now } = ctx;

  const getProject = Effect.fn("TaskStore.getProject")(function* (id: string) {
    const row = yield* one(sql`SELECT * FROM projects WHERE id = ${id}`);
    if (row === undefined) return yield* fail("not_found", `project ${id} not found`);
    return decodeProject(row);
  });

  const listProjects = Effect.fn("TaskStore.listProjects")(function* () {
    const rows = yield* sql`SELECT * FROM projects ORDER BY name`;
    return rows.map((row) => decodeProject(row));
  });

  const findProjectByPath = Effect.fn("TaskStore.findProjectByPath")(function* (path: string) {
    const key = pathKey(path);
    return (yield* listProjects()).find((p) => pathKey(p.root_path) === key) ?? null;
  });

  const prefixOwner = Effect.fnUntraced(function* (prefix: string, exceptId: string | null) {
    for (const row of yield* sql`SELECT id, name FROM projects WHERE prefix = ${prefix}`) {
      const project = decodeProjectIdentity(row);
      if (project.id !== exceptId) return project;
    }
    return null;
  });

  const takenPrefixes = Effect.fnUntraced(function* (exceptId: string | null) {
    const rows =
      exceptId === null
        ? yield* sql`SELECT prefix FROM projects`
        : yield* sql`SELECT prefix FROM projects WHERE id <> ${exceptId}`;
    return new Set(rows.map((row) => decodeProjectPrefix(row).prefix));
  });

  const ensurePrefixFree = Effect.fnUntraced(function* (prefix: string, exceptId: string | null) {
    const owner = yield* prefixOwner(prefix, exceptId);
    if (owner !== null) {
      return yield* fail("conflict", `prefix ${prefix} is already used by project '${owner.name}'`);
    }
    return yield* Effect.void;
  });

  const setProjectPrefix = Effect.fn("TaskStore.setProjectPrefix")(function* (
    id: string,
    input: string,
  ) {
    const project = yield* getProject(id);
    const prefix = yield* normalizePrefix(input);
    if (prefix === project.prefix) return project;
    yield* ensurePrefixFree(prefix, project.id);
    yield* sql`UPDATE projects SET prefix = ${prefix} WHERE id = ${project.id}`;
    yield* rewriteProjectKeys(sql, project.id, prefix);
    return yield* getProject(project.id);
  }, sql.withTransaction);

  const registerProject = Effect.fn("TaskStore.registerProject")(function* (
    input: RegisterProjectInput,
  ) {
    const root = normalizePath(input.rootPath);
    const existing = yield* findProjectByPath(root);
    if (existing) {
      if (input.prefix !== undefined && input.prefix !== null) {
        yield* setProjectPrefix(existing.id, input.prefix);
      }
      const sets: Record<string, string> = {};
      const maybe = (col: keyof Project, v: string | null | undefined) => {
        if (v !== undefined && v !== null && v !== existing[col]) sets[col] = v;
      };
      maybe("remote_url", input.remoteUrl);
      maybe("coordinator_environment_id", input.coordinatorEnvironmentId);
      maybe("coordinator_thread_id", input.coordinatorThreadId);
      maybe("coordinator_thread_link", input.coordinatorThreadLink);
      if (Object.keys(sets).length > 0) {
        yield* sql`UPDATE projects SET ${sql.update(sets)} WHERE id = ${existing.id}`;
      }
      return { project: yield* getProject(existing.id), created: false };
    }
    const name = optText(input.name) ?? (basename(root) || "project");
    const clash = yield* one(sql`SELECT id FROM projects WHERE name = ${name}`);
    if (clash)
      return yield* fail("conflict", `a project named '${name}' already exists; pass --name`);
    const requested =
      input.prefix === undefined || input.prefix === null
        ? null
        : yield* normalizePrefix(input.prefix);
    if (requested !== null) yield* ensurePrefixFree(requested, null);
    const prefix = requested ?? uniqueProjectPrefix(name, yield* takenPrefixes(null));
    const id = ulid();
    const at = yield* now;
    yield* sql`INSERT INTO projects ${sql.insert({
      id,
      machine_id: machine,
      name,
      prefix,
      root_path: root,
      remote_url: optText(input.remoteUrl),
      coordinator_environment_id: optText(input.coordinatorEnvironmentId),
      coordinator_thread_id: optText(input.coordinatorThreadId),
      coordinator_thread_link: optText(input.coordinatorThreadLink),
      created_at: at,
    })}`;
    return { project: yield* getProject(id), created: true };
  }, sql.withTransaction);

  const resolveProject = Effect.fn("TaskStore.resolveProject")(function* (ref: string) {
    const all = yield* listProjects();
    const byId = all.find((p) => p.id === ref);
    if (byId) return byId;
    const byName = all.filter((p) => p.name === ref);
    const only = byName.length === 1 ? byName[0] : undefined;
    if (only !== undefined) return only;
    if (byName.length > 1)
      return yield* fail("ambiguous", `project name '${ref}' is ambiguous; use its id`);
    const byPath = yield* findProjectByPath(ref);
    if (byPath) return byPath;
    return yield* fail("not_found", `project '${ref}' not found (run 'nf init' in the repo)`);
  });

  return {
    getProject,
    listProjects,
    findProjectByPath,
    registerProject,
    setProjectPrefix,
    resolveProject,
  };
};

export type ProjectStore = ReturnType<typeof projectStore>;
