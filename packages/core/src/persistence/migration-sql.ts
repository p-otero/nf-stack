/** Portability (a Postgres layer later): TEXT ULIDs, ISO 8601 UTC timestamps, JSON as TEXT,
 * booleans as 0/1. Triggers and partial indexes only back up the invariants the store checks
 * first. A new version never loses data: it adds, drops an unused index, or rebuilds a table
 * keeping every row; `docs/architecture.md` ("Schema") holds the change policy. */

const V1 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  remote_url TEXT,
  coordinator_environment_id TEXT,
  coordinator_thread_id TEXT,
  coordinator_thread_link TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  seq INTEGER NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','todo','working','review','blocked','done','cancelled')),
  profile TEXT,
  analysis_mode TEXT CHECK (analysis_mode IS NULL OR analysis_mode IN ('review','autonomous')),
  authorization TEXT,
  decision_needed TEXT,
  blocker TEXT,
  evidence TEXT,
  accepted_first_pass INTEGER CHECK (accepted_first_pass IS NULL OR accepted_first_pass IN (0,1)),
  human_interventions INTEGER NOT NULL DEFAULT 0 CHECK (human_interventions >= 0),
  source TEXT,
  design_ref TEXT,
  superseded_by TEXT REFERENCES tasks (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, key),
  UNIQUE (project_id, seq)
);
CREATE INDEX tasks_project_status ON tasks (project_id, status);

CREATE TABLE task_acceptance (
  task_id TEXT NOT NULL REFERENCES tasks (id),
  position INTEGER NOT NULL CHECK (position >= 1),
  text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'unverified' CHECK (result IN ('pass','fail','unverified')),
  evidence TEXT,
  PRIMARY KEY (task_id, position)
);

CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks (id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks (id),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX task_deps_reverse ON task_deps (depends_on_task_id);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  seq INTEGER NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('implementation','integration','research','design','review')),
  status TEXT NOT NULL CHECK (status IN ('dispatching','active','succeeded','failed','cancelled','superseded','unknown')),
  mechanism TEXT NOT NULL CHECK (mechanism IN ('delegate_task','t3_thread_launch','thread_send_reuse','fork')),
  environment_id TEXT,
  thread_id TEXT,
  thread_link TEXT,
  t3_task_id TEXT,
  client_request_id TEXT,
  provider_instance_id TEXT,
  model TEXT,
  options TEXT,
  executed_model TEXT,
  profile TEXT,
  reason TEXT,
  fallbacks TEXT NOT NULL DEFAULT '[]',
  context_mode TEXT NOT NULL DEFAULT 'fresh' CHECK (context_mode IN ('fresh','fork','reuse','compact')),
  source_thread_id TEXT,
  repair_of TEXT REFERENCES attempts (id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  base_commit TEXT,
  worktree TEXT,
  branch TEXT,
  diff_location TEXT,
  outcome TEXT,
  failure_class TEXT,
  failure_detail TEXT,
  retry_at TEXT,
  last_verified TEXT,
  remaining TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, seq),
  UNIQUE (task_id, key)
);
CREATE INDEX attempts_task_status ON attempts (task_id, status);
CREATE UNIQUE INDEX attempts_one_live_writer ON attempts (task_id)
  WHERE status IN ('dispatching','active','unknown') AND kind IN ('implementation','integration');
CREATE UNIQUE INDEX attempts_client_request ON attempts (task_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE attempt_commits (
  attempt_id TEXT NOT NULL REFERENCES attempts (id),
  position INTEGER NOT NULL,
  sha TEXT NOT NULL,
  PRIMARY KEY (attempt_id, sha)
);

CREATE TABLE attempt_checks (
  attempt_id TEXT NOT NULL REFERENCES attempts (id),
  position INTEGER NOT NULL,
  command TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','fail','not_run')),
  detail TEXT,
  PRIMARY KEY (attempt_id, position)
);

CREATE TABLE attempt_reports (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts (id),
  kind TEXT NOT NULL CHECK (kind IN ('checkpoint','result')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attempt_reports_attempt ON attempt_reports (attempt_id, id);
CREATE TRIGGER attempt_reports_no_update BEFORE UPDATE ON attempt_reports
BEGIN SELECT RAISE(ABORT, 'attempt_reports is append-only'); END;
CREATE TRIGGER attempt_reports_no_delete BEFORE DELETE ON attempt_reports
BEGIN SELECT RAISE(ABORT, 'attempt_reports is append-only'); END;

CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  attempt_id TEXT REFERENCES attempts (id),
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('coordinator','worker','reviewer','user','system')),
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX task_events_task ON task_events (task_id, id);
CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events
BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;
CREATE TRIGGER task_events_no_delete BEFORE DELETE ON task_events
BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;
`;

const V2 = `
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('t3','pi')),
  source_key TEXT NOT NULL UNIQUE,
  machine_id TEXT NOT NULL,
  t3_thread_id TEXT,
  native_session_id TEXT,
  run_id TEXT,
  turn_id TEXT,
  provider TEXT,
  model TEXT,
  ts TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  usage_status TEXT NOT NULL CHECK (usage_status IN ('complete','partial','unavailable')),
  is_subagent INTEGER NOT NULL DEFAULT 0 CHECK (is_subagent IN (0,1)),
  cost_usd REAL,
  cost_quality TEXT NOT NULL CHECK (cost_quality IN ('reported','estimated','unknown')),
  price_source TEXT,
  price_date TEXT,
  attempt_id TEXT REFERENCES attempts (id),
  bucket TEXT NOT NULL CHECK (bucket IN ('attempt','coordination','unattributed')),
  created_at TEXT NOT NULL
);
CREATE INDEX usage_events_ts ON usage_events (ts);
CREATE INDEX usage_events_attempt ON usage_events (attempt_id);
CREATE INDEX usage_events_thread_ts ON usage_events (t3_thread_id, ts);
CREATE INDEX usage_events_bucket ON usage_events (bucket);

CREATE TABLE sync_state (
  source TEXT PRIMARY KEY CHECK (source IN ('t3','pi')),
  cursor TEXT,
  last_run_at TEXT NOT NULL,
  last_status TEXT NOT NULL CHECK (last_status IN ('ok','partial','failed')),
  last_error TEXT,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0
);
`;

const V3 = `
CREATE TABLE catalog_snapshots (
  environment_id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  providers TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE route_blocks (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  provider_instance_id TEXT NOT NULL,
  model TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('quota','auth','availability','other')),
  reset_at TEXT,
  evidence TEXT,
  blocked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_instance_id, model)
);
`;

const V4 = `
ALTER TABLE tasks ADD COLUMN strategy TEXT
  CHECK (strategy IS NULL OR strategy IN ('direct','plan','cheap','review','auto'));

ALTER TABLE attempts ADD COLUMN strategy TEXT
  CHECK (strategy IS NULL OR strategy IN ('direct','plan','cheap','review','auto'));
`;

/**
 * SQLite cannot alter a CHECK constraint in place, so the `direct` mechanism needs a table
 * rebuild. `attempts` is referenced by several tables, and foreign key enforcement cannot be
 * suspended mid-transaction; `migrate` runs every migration with enforcement off and checks
 * `foreign_key_check` before committing (see `migrate`).
 */
const V5 = `
CREATE TABLE attempts_v5 (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  seq INTEGER NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('implementation','integration','research','design','review')),
  status TEXT NOT NULL CHECK (status IN ('dispatching','active','succeeded','failed','cancelled','superseded','unknown')),
  mechanism TEXT NOT NULL CHECK (mechanism IN ('delegate_task','t3_thread_launch','thread_send_reuse','fork','direct')),
  environment_id TEXT,
  thread_id TEXT,
  thread_link TEXT,
  t3_task_id TEXT,
  client_request_id TEXT,
  provider_instance_id TEXT,
  model TEXT,
  options TEXT,
  executed_model TEXT,
  profile TEXT,
  reason TEXT,
  fallbacks TEXT NOT NULL DEFAULT '[]',
  context_mode TEXT NOT NULL DEFAULT 'fresh' CHECK (context_mode IN ('fresh','fork','reuse','compact')),
  source_thread_id TEXT,
  repair_of TEXT REFERENCES attempts_v5 (id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  base_commit TEXT,
  worktree TEXT,
  branch TEXT,
  diff_location TEXT,
  outcome TEXT,
  failure_class TEXT,
  failure_detail TEXT,
  retry_at TEXT,
  last_verified TEXT,
  remaining TEXT,
  updated_at TEXT NOT NULL,
  strategy TEXT CHECK (strategy IS NULL OR strategy IN ('direct','plan','cheap','review','auto')),
  UNIQUE (task_id, seq),
  UNIQUE (task_id, key)
);

INSERT INTO attempts_v5 (id, machine_id, task_id, seq, key, kind, status, mechanism,
  environment_id, thread_id, thread_link, t3_task_id, client_request_id, provider_instance_id,
  model, options, executed_model, profile, reason, fallbacks, context_mode, source_thread_id,
  repair_of, started_at, ended_at, base_commit, worktree, branch, diff_location, outcome,
  failure_class, failure_detail, retry_at, last_verified, remaining, updated_at, strategy)
SELECT id, machine_id, task_id, seq, key, kind, status, mechanism, environment_id, thread_id,
  thread_link, t3_task_id, client_request_id, provider_instance_id, model, options,
  executed_model, profile, reason, fallbacks, context_mode, source_thread_id, repair_of,
  started_at, ended_at, base_commit, worktree, branch, diff_location, outcome, failure_class,
  failure_detail, retry_at, last_verified, remaining, updated_at, strategy
FROM attempts;

DROP TABLE attempts;
ALTER TABLE attempts_v5 RENAME TO attempts;

CREATE INDEX attempts_task_status ON attempts (task_id, status);
CREATE UNIQUE INDEX attempts_one_live_writer ON attempts (task_id)
  WHERE status IN ('dispatching','active','unknown') AND kind IN ('implementation','integration');
CREATE UNIQUE INDEX attempts_client_request ON attempts (task_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE subagent_spawns (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  parent_t3_thread_id TEXT NOT NULL,
  parent_run_id TEXT,
  child_t3_thread_id TEXT,
  provider TEXT,
  model TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('app_owned','native')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  attempt_id TEXT REFERENCES attempts (id),
  created_at TEXT NOT NULL
);
CREATE INDEX subagent_spawns_parent ON subagent_spawns (parent_t3_thread_id, started_at);
CREATE INDEX subagent_spawns_child ON subagent_spawns (child_t3_thread_id);
CREATE INDEX subagent_spawns_attempt ON subagent_spawns (attempt_id);

ALTER TABLE usage_events ADD COLUMN parent_attempt_id TEXT REFERENCES attempts (id);
CREATE INDEX usage_events_parent_attempt ON usage_events (parent_attempt_id);
`;

/** Project keys carry a per-project prefix; v6 adds the column and `assignProjectPrefixes` fills it. */
const V6 = `
ALTER TABLE projects ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
`;

/** v7 flags UI tasks and stores the evidence attached to an attempt. */
const V7 = `
ALTER TABLE tasks ADD COLUMN ui INTEGER NOT NULL DEFAULT 0 CHECK (ui IN (0,1));

CREATE TABLE attempt_attachments (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts (id),
  kind TEXT NOT NULL CHECK (kind IN ('screenshot','recording','file')),
  theme TEXT CHECK (theme IS NULL OR theme IN ('light','dark')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attempt_attachments_attempt ON attempt_attachments (attempt_id, id);
`;

/** v8 records the pull request an attempt opened, so the board can show where its code is. */
const V8 = `
ALTER TABLE attempts ADD COLUMN pr_url TEXT;
`;

/**
 * v9 stores which coordinator started an attempt and the model it was running, so cost and
 * first-pass rates can be compared per coordinating model. The registry admits additional
 * coordinator threads per project; the v9 data step fills existing attempts from their threads.
 */
const V9 = `
ALTER TABLE attempts ADD COLUMN coordinator_thread_id TEXT;
ALTER TABLE attempts ADD COLUMN coordinator_model TEXT;

CREATE TABLE coordinator_threads (
  project_id TEXT NOT NULL REFERENCES projects (id),
  thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, thread_id)
);
CREATE INDEX coordinator_threads_thread ON coordinator_threads (thread_id);
`;

/**
 * v10 drops the indexes no statement in `packages/core/src/persistence` reads. Every filtered read
 * of these tables constrains another column: task dependencies and coordinator threads by their
 * primary-key prefix, usage events by attempt, thread or bucket. The indexes only cost writes and
 * space, and each can come back in an additive migration when a query needs it.
 */
const V10 = `
DROP INDEX usage_events_ts;
DROP INDEX task_deps_reverse;
DROP INDEX coordinator_threads_thread;
DROP INDEX subagent_spawns_child;
`;

/** Index i holds the migration that brings user_version from i to i + 1. */
export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10];
export const LATEST_VERSION = MIGRATIONS.length;
