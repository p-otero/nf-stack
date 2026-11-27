export const HELP = `nf - task and attempt state for NF-Stack (SQLite store in $NF_HOME, default ~/.nf)

usage: nf <command> [options]      add --json for machine output

  init                         register the current Git repo as a project
           [--name] [--prefix e.g. NF]  the prefix of its task keys (derived from the name,
                                        unique per store; must be unique)
  project set [--prefix XYZ]   change the project's key prefix (re-keys its tasks/attempts)
  coordinator register [--thread <id>] [--project]
                               record one more coordinator thread of this project (idempotent);
                               its own turns count as coordination in stats
  status                       counts, live attempts, ready tasks, proposals
  task add --title --goal --acceptance (repeatable) [--depends-on NF-001] [--profile]
           [--analysis-mode review|autonomous] [--strategy direct|plan|cheap|review|auto]
           [--status proposed|todo] [--ui|--no-ui]
  task list [--status s] [--all-projects]      task show NF-001 [--events]      task next
  task set NF-001 [--status s] [--reason] [--reopen] [--blocker JSON] [--evidence]
                [--strategy direct|plan|cheap|review|auto] [--ui|--no-ui] ...
                [--title] [--goal] [--acceptance (repeatable, replaces)]
                [--add-acceptance (repeatable)] [--remove-acceptance N]
                                a new or rewritten acceptance item returns to unverified;
                                an unchanged one keeps its result; a done or cancelled task
                                needs --reopen in the same call
  task approve NF-001           task accept NF-001 [--approved-by-user]
                                (a UI task needs one screenshot per project theme on its
                                accepted attempt; a large UI change also needs the user's
                                approval, a small one does not — see ui.review)
  task reject NF-001 --comment  send a review back to working with the comment as its repair note
  task intervene NF-001 --note
  task check NF-001 --item N --result pass|fail|unverified [--evidence]
  task depend NF-001 --on NF-002
  attempt start NF-001 --kind --mechanism [--provider --model --options JSON --profile
           --strategy direct|plan|cheap|review|auto (default: the task's)
           --coordinator-model (default: the model of the coordinator's closest turn)
           --reason --context-mode --source-thread --repair-of --client-request-id --base-commit]
                               prints the attempt key and its client request id
  attempt update NF-001-A1 [--status --thread-id --thread-link --t3-task-id --executed-model
           --worktree --branch --add-fallback JSON --add-commit sha --add-check JSON]
  attempt finish NF-001-A1 --status succeeded|failed|cancelled|superseded [--outcome
           --failure-class --failure-detail --retry-at --last-verified --remaining]
  attempt report NF-001-A1 --kind checkpoint|result [--file f]   (body on stdin; workers use this)
  attempt reconcile [--apply] [--stall-minutes N]
                               judge every live attempt from T3's state: running, stalled,
                               waiting_input, finished_ok, finished_failed or missing
                               (read-only unless --apply); binds an attempt with no thread to
                               the delegated thread T3 created for it
  attempt show NF-001-A1 [--reports] [--attachments]
  attempt attach NF-001-A1 --file path [--kind screenshot|recording|file]
           [--theme light|dark] [--name screen]
                               copy the file into $NF_HOME/artifacts and record it on the attempt
                               (one screenshot per project theme; --theme must be declared
                               in $NF_HOME/projects/<prefix>.yaml)
  import [path]                import .nf/tasks.json (schema v1 or v2), idempotent
  sync [--source t3|pi|all] [--dry-run] [--coordinator-thread id]
                               ingest per-turn token usage from T3 Code and Pi (read-only)
  stats [--by task|attempt|model|profile|month|strategy|context|coordinator]
        [--profile-breakdown] [--all-projects]
        stats task NF-001       token usage, API-equivalent cost and per-attempt cost to acceptance
                               (--by strategy: tasks, cost to acceptance and first-pass rate;
                                --by context: the same per context transfer;
                                --by coordinator: the same per coordinating model, with its own
                                turns and --profile-breakdown sub-rows)
  policy show [--profile p] [--json]
                               validate the machine policy $NF_HOME/policy.yaml (copy the template
                               there when missing) and print its profiles
  policy check [--file f] [--env id] [--json]
                               merge a T3 orchestrator_capabilities JSON result (stdin or --file)
                               into that environment's cached catalog; report policy models that
                               are missing or only cached elsewhere
  policy status                one line; exits 3 when the local catalog is stale or never checked
  policy propose [--file f] [--env id] [--reorder] [--init] [--json]
                               diff the policy against a T3 orchestrator_capabilities result (stdin
                               or --file), caching the catalog too; writes the proposal to
                               $NF_HOME/policy.proposal.json (--init writes a missing policy)
  policy apply [--file proposal.json] [--json]
                               write the proposal: timestamped backup, comments and unknown keys
                               kept, pinned candidates untouched, stale proposals refused
  policy resolve <profile> [--env id] [--exclude provider:model] [--approved] [--json]
                               first eligible candidate plus its delegate_task target (--approved
                               is required for a profile that needs the user's approval)
  route block --provider --model --reason quota|auth|availability|other [--reset-at ISO]
              [--evidence text]    stop routing to a route until reset (or until unblocked)
  route unblock --provider --model | --all      route list
  board [--out path] [--json-only]
                               write a self-contained HTML snapshot of this project's tasks
                               (default $NF_HOME/boards/<project>-<UTC timestamp>.html)
  serve [--port 4646]          serve the live board of every project on 127.0.0.1 (read-only;
                               reuses an nf serve already on that port, same NF_HOME only)
  t3 init [--port 4646]        add the Board script (nf serve + its preview URL) to this project's
                               t3.json so T3 Code can import it; idempotent
  backup                       snapshot to $NF_HOME/backups/ (keeps the newest NF_BACKUP_KEEP,
                               default 10)
  skills link [--dry-run] [--force]   link skills/nf-* into ~/.agents and ~/.claude
  setup                        check Node and git, link the packaged skills/nf-* and prove that
                               nf --version, status, policy status and a temporary serve answer;
                               idempotent, and everything 'bun run setup' proves after its build
  --version, help

global options: --project <name|id|path>  --actor coordinator|worker|reviewer|user|system`;

/**
 * Command paths `nf help` documents. The skills test checks every `nf <command> [subcommand]`
 * mention against this list, and this list against HELP, so a skill cannot cite a command the CLI
 * does not ship.
 */
export const HELP_COMMANDS: readonly string[] = [
  "init",
  "project set",
  "coordinator register",
  "status",
  "task add",
  "task list",
  "task show",
  "task next",
  "task set",
  "task approve",
  "task accept",
  "task reject",
  "task intervene",
  "task check",
  "task depend",
  "attempt start",
  "attempt update",
  "attempt finish",
  "attempt report",
  "attempt reconcile",
  "attempt show",
  "attempt attach",
  "import",
  "sync",
  "stats",
  "stats task",
  "policy show",
  "policy check",
  "policy status",
  "policy propose",
  "policy apply",
  "policy resolve",
  "route block",
  "route unblock",
  "route list",
  "board",
  "serve",
  "t3 init",
  "backup",
  "skills link",
  "setup",
];
