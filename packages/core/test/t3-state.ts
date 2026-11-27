import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tempDir } from "./helpers.ts";

const SCHEMA = `
  CREATE TABLE orchestration_v2_projection_threads (
    thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
    default_provider TEXT NOT NULL DEFAULT '', runtime_mode TEXT NOT NULL DEFAULT '',
    interaction_mode TEXT NOT NULL DEFAULT '', active_provider_thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    archived_at TEXT, deleted_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_runs (
    run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT '', provider_thread_id TEXT, status TEXT NOT NULL,
    requested_at TEXT NOT NULL, completed_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_nodes (
    node_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, parent_node_id TEXT,
    root_node_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '', provider_thread_id TEXT, provider_turn_id TEXT,
    runtime_request_id TEXT, checkpoint_scope_id TEXT, started_at TEXT, completed_at TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_turn_items (
    turn_item_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, node_id TEXT,
    provider_thread_id TEXT, provider_turn_id TEXT, parent_item_id TEXT,
    ordinal INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_provider_turns (
    provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, provider_thread_id TEXT NOT NULL,
    node_id TEXT NOT NULL, run_attempt_id TEXT, ordinal INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_messages (
    message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, node_id TEXT,
    role TEXT NOT NULL DEFAULT '', streaming INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_runtime_requests (
    runtime_request_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, node_id TEXT NOT NULL,
    provider_turn_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, resolved_at TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE orchestration_v2_projection_subagents (
    subagent_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT,
    parent_node_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '',
    provider_thread_id TEXT, child_thread_id TEXT, origin TEXT NOT NULL DEFAULT 'app_owned',
    status TEXT NOT NULL DEFAULT 'running', started_at TEXT, completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}',
    driver TEXT, provider_instance_id TEXT, completion_delivery_state TEXT
  );
`;

export interface T3State {
  file: string;
  db: DatabaseSync;
}

/** A T3 `statev2.sqlite` with the projections liveness reads, for the test to fill in. */
export function t3State(dir = tempDir("nf-t3-")): T3State {
  const file = join(dir, "statev2.sqlite");
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return { file, db };
}

export function thread(db: DatabaseSync, id: string, over: { deletedAt?: string } = {}): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_threads (thread_id, deleted_at)
     VALUES (?, ?)`,
  ).run(id, over.deletedAt ?? null);
}

/** The thread id T3 derives for a `delegate_task` dispatch carrying this client request id. */
export function delegatedThreadId(
  clientRequestId: string,
  commandId = "command:mcp:0b11452e-559e-4cc1-867f-2739d2357459",
): string {
  return `thread:delegated-task:${encodeURIComponent(`${commandId}:delegate-task:${clientRequestId}`)}`;
}

/** A `delegate_task` T3 projected under the thread that commanded it, with the brief it sent. */
export function delegation(
  db: DatabaseSync,
  input: {
    id: string;
    parent: string;
    child: string;
    prompt: string;
    startedAt?: string;
    origin?: string;
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_subagents
       (subagent_id, thread_id, run_id, parent_node_id, provider, child_thread_id, origin,
        status, started_at, updated_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id,
    input.parent,
    null,
    `node:${input.id}`,
    "pi",
    input.child,
    input.origin ?? "app_owned",
    "running",
    input.startedAt ?? null,
    input.startedAt ?? "",
    JSON.stringify({ id: input.id, childThreadId: input.child, prompt: input.prompt }),
  );
}

export function run(
  db: DatabaseSync,
  input: {
    id: string;
    thread: string;
    ordinal: number;
    status: string;
    requestedAt: string;
    completedAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_runs
       (run_id, thread_id, ordinal, status, requested_at, completed_at) VALUES (?,?,?,?,?,?)`,
  ).run(
    input.id,
    input.thread,
    input.ordinal,
    input.status,
    input.requestedAt,
    input.completedAt ?? null,
  );
}

export function turnItem(
  db: DatabaseSync,
  input: {
    id: string;
    thread: string;
    run: string;
    updatedAt: string;
    type?: string;
    failure?: { class: string; message: string };
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_turn_items
       (turn_item_id, thread_id, run_id, type, status, updated_at, payload_json)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    input.id,
    input.thread,
    input.run,
    input.type ?? "assistant_message",
    "completed",
    input.updatedAt,
    JSON.stringify(input.failure === undefined ? {} : { failure: input.failure }),
  );
}

export function providerTurn(
  db: DatabaseSync,
  input: {
    id: string;
    thread: string;
    node: string;
    run: string;
    startedAt?: string;
    completedAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_nodes (node_id, thread_id, run_id, kind, status)
     VALUES (?,?,?, 'root_turn', 'running')`,
  ).run(input.node, input.thread, input.run);
  db.prepare(
    `INSERT INTO orchestration_v2_projection_provider_turns
       (provider_turn_id, thread_id, provider_thread_id, node_id, status, started_at, completed_at)
     VALUES (?,?,?,?, 'running', ?, ?)`,
  ).run(
    input.id,
    input.thread,
    `provider-thread:${input.thread}`,
    input.node,
    input.startedAt ?? null,
    input.completedAt ?? null,
  );
}

/** The user message T3 projected for a `t3_thread_send` carrying this client request id. */
export function sentFollowUp(
  db: DatabaseSync,
  input: {
    clientRequestId: string;
    thread: string;
    run: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_messages
       (message_id, thread_id, run_id, role, created_at, updated_at)
     VALUES (?,?,?,'user',?,?)`,
  ).run(
    `message:mcp:0b11452e-559e-4cc1-867f-2739d2357459:thread-send:${input.clientRequestId}`,
    input.thread,
    input.run,
    input.createdAt,
    input.createdAt,
  );
}

export function waitingRequest(
  db: DatabaseSync,
  input: {
    id: string;
    thread: string;
    node: string;
    run: string;
    kind?: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_v2_projection_nodes (node_id, thread_id, run_id, kind, status)
     VALUES (?,?,?, 'user_input_request', 'waiting')`,
  ).run(input.node, input.thread, input.run);
  db.prepare(
    `INSERT INTO orchestration_v2_projection_runtime_requests
       (runtime_request_id, thread_id, node_id, kind, status, created_at)
     VALUES (?,?,?,?, 'pending', ?)`,
  ).run(input.id, input.thread, input.node, input.kind ?? "user_input", input.createdAt);
}
