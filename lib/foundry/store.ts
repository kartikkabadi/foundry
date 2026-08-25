import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { appendEvent, type EventActor } from "./log";
import type { LearningRecord, LearningStoreAdapter } from "./learning";
import {
  applyAutomationControlPatch,
  AutomationControlStaleVersionError,
  AutomationControlValidationError,
  defaultAutomationControl,
  isAutomationAuthority,
  type AutomationAuthority,
  type AutomationControl,
  type AutomationControlAdapter,
  type AutomationControlPatch,
} from "./automation-control";
import {
  applyAuthorityProfilePatch,
  defaultAuthorityProfile,
  type AuthorityProfile,
  type AuthorityScope,
} from "./authority";
import { dbPath } from "./paths";
import {
  runSupervisorTick,
  type SupervisorLease,
  type SupervisorStoreAdapter,
  type SupervisorTickEvent,
  type SupervisorTickInput,
  type SupervisorTickResult,
} from "./automation-supervisor";
import {
  STAGES,
  STALE_JOB_MS,
  skippedStages,
  type Cycle,
  type CycleStatus,
  type DecisionTicket,
  type Issue,
  type IssueArtifact,
  type IssueJob,
  type IssueSize,
  type IssueStage,
  type JobStatus,
  type Module,
  type NavCounts,
  type Project,
  type RunMode,
  type StageId,
  type StageStatus,
  gateFor,
  isOneshotWalking,
  parseRunMode,
} from "./types";

let db: DatabaseSync | null = null;

const ORCHESTRATION_SCHEMA = `
    CREATE TABLE IF NOT EXISTS orchestration_runs (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','succeeded','failed','cancelled')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestration_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('blocked','ready','leased','running','verifying','succeeded','failed','cancelled')),
      deps TEXT NOT NULL DEFAULT '[]',
      host TEXT,
      isolation_kind TEXT,
      isolation_ref TEXT,
      resources TEXT NOT NULL,
      model TEXT NOT NULL,
      route TEXT NOT NULL,
      claims TEXT NOT NULL DEFAULT '[]',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      retryable INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      error TEXT,
      lease_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orch_tasks_run ON orchestration_tasks (run_id);
    CREATE INDEX IF NOT EXISTS idx_orch_tasks_state ON orchestration_tasks (state);
    CREATE TABLE IF NOT EXISTS orchestration_attempts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orch_attempts_task ON orchestration_attempts (task_id);
    CREATE TABLE IF NOT EXISTS orchestration_leases (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      host TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orch_leases_task ON orchestration_leases (task_id);
    CREATE TABLE IF NOT EXISTS orchestration_claims (
      task_id TEXT NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (task_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_orch_claims_path ON orchestration_claims (path);
    CREATE TABLE IF NOT EXISTS orchestration_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT,
      body TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orch_artifacts_task ON orchestration_artifacts (task_id);
`;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      idea TEXT NOT NULL,
      target_url TEXT NOT NULL,
      size TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issue_stages (
      issue_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      skip_reason TEXT,
      PRIMARY KEY (issue_id, stage)
    );
    CREATE TABLE IF NOT EXISTS decision_tickets (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      prior_match TEXT,
      answer TEXT
    );
    CREATE TABLE IF NOT EXISTS issue_artifacts (
      issue_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      stage TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (issue_id, kind)
    );
    CREATE TABLE IF NOT EXISTS issue_jobs (
      issue_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,
      next_retry_at TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (issue_id, stage)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    ${ORCHESTRATION_SCHEMA}
    CREATE TABLE IF NOT EXISTS learning_records (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      issue TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_control (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      authority TEXT NOT NULL DEFAULT 'observe',
      operator_hold INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 5,
      max_iterations INTEGER NOT NULL DEFAULT 10,
      max_cost_usd REAL NOT NULL DEFAULT 1,
      per_candidate_ceiling_usd REAL NOT NULL DEFAULT 0.5,
      paid_authorization INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
`;

/** Durable singleton-lease and tick-ledger schema for the automation
 *  supervisor. The lease is a single row (`id = 1`) whose fields are swapped
 *  by atomic compare-and-set statements; the tick ledger is keyed by `tick_id`
 *  so a terminal outcome is recorded exactly once and a replayed tick id is a
 *  durable no-op. `busy` is a nonterminal signal and is never written, but it
 *  is admitted here so the ledger type stays closed. */
const SUPERVISOR_SCHEMA = `
    CREATE TABLE IF NOT EXISTS supervisor_lease (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lease_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      tick_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS supervisor_ticks (
      tick_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (
        outcome IN ('disabled','held','denied','duplicate-tick','lease-held','busy','ran','idle','failed')
      ),
      reason TEXT NOT NULL,
      at TEXT NOT NULL,
      previous_owner TEXT
    );
`;

function migrate(conn: DatabaseSync): void {
  conn.exec(ORCHESTRATION_SCHEMA);
  conn.exec(SUPERVISOR_SCHEMA);
  ensureColumn(conn, "issues", "project_id", "TEXT");
  ensureColumn(conn, "issues", "cycle_id", "TEXT");
  ensureColumn(conn, "issues", "module_id", "TEXT");
  ensureColumn(conn, "issues", "grill_hold", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(conn, "issues", "run_mode", "TEXT NOT NULL DEFAULT 'hitl'");
  ensureColumn(conn, "issues", "walk_hold", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(conn, "issues", "oneshot_stop_reason", "TEXT");
  ensureColumn(conn, "automation_control", "authority", "TEXT NOT NULL DEFAULT 'observe'");
  ensureColumn(conn, "issue_jobs", "heartbeat_at", "TEXT");
  ensureColumn(conn, "issue_jobs", "attempts", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(conn, "issue_jobs", "next_retry_at", "TEXT");
  ensureColumn(conn, "issue_jobs", "retryable", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(conn, "orchestration_tasks", "retryable", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(conn, "orchestration_tasks", "next_retry_at", "TEXT");
}

function backfillProjects(conn: DatabaseSync): void {
  const rows = conn.prepare("SELECT id, target_url FROM issues WHERE project_id IS NULL OR project_id = ''").all() as Array<{
    id: string;
    target_url: string;
  }>;
  for (const row of rows) {
    const project = ensureProjectForUrl(String(row.target_url));
    conn.prepare("UPDATE issues SET project_id = ? WHERE id = ?").run(project.id, row.id);
  }
}

function database(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dbPath());
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    migrate(db);
    backfillProjects(db);
  } else {
    migrate(db);
  }
  return db;
}

/**
 * Shared SQLite connection for the orchestration store. The orchestration
 * tables live in the same database (and schema) as every other Foundry table;
 * there is no second database. Tests may drive the same connection through
 * the existing FOUNDRY_DATA control.
 */
export function orchestrationConnection(): DatabaseSync {
  return database();
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecordString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid learning record: ${field} must be a non-empty string`);
  }
  return value;
}

/** Validates a parsed JSON payload back into a LearningRecord without any casts. */
function parseLearningRecord(value: unknown): LearningRecord {
  if (!isRecordObject(value)) {
    throw new Error("invalid learning record: payload is not an object");
  }
  if (value.kind === "lesson") {
    const id = requireRecordString(value.id, "lesson id");
    const key = requireRecordString(value.key, "lesson key");
    const taskId = requireRecordString(value.taskId, "taskId");
    const issueId = requireRecordString(value.issueId, "issueId");
    const stage = value.stage;
    if (stage !== "execute") throw new Error("invalid learning record: lesson stage must be 'execute'");
    const outcome = value.outcome;
    if (outcome !== "succeeded" && outcome !== "failed") {
      throw new Error("invalid learning record: lesson outcome must be terminal");
    }
    const pattern = requireRecordString(value.pattern, "pattern");
    const retentionRule = requireRecordString(value.retentionRule, "retentionRule");
    const refs = value.refs;
    if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string")) {
      throw new Error("invalid learning record: lesson refs must be an array of strings");
    }
    const rawAuthor = value.author;
    if (rawAuthor !== undefined && rawAuthor !== null && typeof rawAuthor !== "string") {
      throw new Error("invalid learning record: lesson author must be a string or null");
    }
    const proposedAt = requireRecordString(value.proposedAt, "proposedAt");
    return {
      kind: "lesson",
      id,
      key,
      taskId,
      issueId,
      stage,
      outcome,
      pattern,
      retentionRule,
      refs,
      author: typeof rawAuthor === "string" ? rawAuthor : null,
      proposedAt,
    };
  }
  if (value.kind === "promotion") {
    const id = requireRecordString(value.id, "promotion id");
    const key = requireRecordString(value.key, "promotion key");
    const lessonId = requireRecordString(value.lessonId, "lessonId");
    const issueId = requireRecordString(value.issueId, "issueId");
    const reviewer = requireRecordString(value.reviewer, "reviewer");
    const approvedAt = requireRecordString(value.approvedAt, "approvedAt");
    return { kind: "promotion", id, key, lessonId, issueId, reviewer, approvedAt };
  }
  throw new Error(`invalid learning record: unknown kind ${String(value.kind)}`);
}

/**
 * Durable learning adapter over the shared SQLite database. Rows live in the
 * `learning_records` table in the same schema and connection as every other
 * Foundry table, so a fresh adapter instance reads the same records and a
 * replayed append (same unique id) is a no-op via INSERT OR IGNORE. Payloads
 * are stored as JSON and validated back into LearningRecord on load — never
 * cast, never `any`.
 */
export function createLearningStore(): LearningStoreAdapter {
  const conn = database();
  const select = conn.prepare(
    "SELECT payload FROM learning_records ORDER BY timestamp ASC, id ASC",
  );
  const insert = conn.prepare(
    "INSERT OR IGNORE INTO learning_records (id, kind, key, issue, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  );
  return {
    load: () => {
      const rows = select.all() as Record<string, unknown>[];
      return rows.map((row) => parseLearningRecord(JSON.parse(String(row.payload)) as unknown));
    },
    append: (record) => {
      insert.run(
        record.id,
        record.kind,
        record.key,
        record.issueId,
        JSON.stringify(record),
        record.kind === "lesson" ? record.proposedAt : record.approvedAt,
      );
    },
  };
}

const CONTROL_UPDATE_SQL = `
  UPDATE automation_control SET
    enabled = ?, authority = ?, operator_hold = ?, "limit" = ?, max_iterations = ?,
    max_cost_usd = ?, per_candidate_ceiling_usd = ?,
    paid_authorization = ?, version = ?, updated_at = ?
  WHERE id = 1 AND version = ?
`;

/**
 * Durable automation control over the shared SQLite database. A single
 * singleton row (`id = 1`) holds the operator control record for the
 * autonomous driver; a fresh adapter reads the same row from disk. Every
 * mutation is an integer-version compare-and-set, so a stale write (one based
 * on an outdated snapshot) fails instead of clobbering newer control state.
 * The adapter only persists control state — it never runs a pass, never calls
 * `planAutomation`, and never starts work.
 */
export function createAutomationControlStore(
  options: { now?: () => string } = {},
): AutomationControlAdapter {
  const conn = database();
  const stamp = options.now ?? (() => new Date().toISOString());
  const ensureRow = conn.prepare(
    `INSERT OR IGNORE INTO automation_control (
      id, enabled, authority, operator_hold, "limit", max_iterations, max_cost_usd,
      per_candidate_ceiling_usd, paid_authorization, version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const select = conn.prepare(
    `SELECT enabled, authority, operator_hold, "limit", max_iterations, max_cost_usd,
            per_candidate_ceiling_usd, paid_authorization, version, updated_at
     FROM automation_control WHERE id = 1`,
  );
  const update = conn.prepare(CONTROL_UPDATE_SQL);

  function mapControl(row: Record<string, unknown>): AutomationControl {
    const authority = isAutomationAuthority(row.authority) ? row.authority : "observe";
    return {
      enabled: Boolean(row.enabled),
      authority,
      operatorHold: Boolean(row.operator_hold),
      limit: Number(row.limit),
      maxIterations: Number(row.max_iterations),
      maxCostUsd: Number(row.max_cost_usd),
      perCandidateCeilingUsd: Number(row.per_candidate_ceiling_usd),
      paidAuthorization: Boolean(row.paid_authorization),
      version: Number(row.version),
      updatedAt: String(row.updated_at),
    };
  }

  function ensureRowExists(): void {
    const defaults = defaultAutomationControl(stamp());
    ensureRow.run(
      1,
      defaults.enabled ? 1 : 0,
      defaults.authority,
      defaults.operatorHold ? 1 : 0,
      defaults.limit,
      defaults.maxIterations,
      defaults.maxCostUsd,
      defaults.perCandidateCeilingUsd,
      defaults.paidAuthorization ? 1 : 0,
      defaults.version,
      defaults.updatedAt,
    );
  }

  function requireRow(): AutomationControl {
    ensureRowExists();
    const row = select.get() as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error("automation control: singleton row missing after ensure");
    }
    return mapControl(row);
  }

  return {
    get: () => requireRow(),
    update: (patch, expectedVersion) => {
      if (!Number.isSafeInteger(expectedVersion)) {
        throw new AutomationControlValidationError(
          `expectedVersion must be an integer, received ${String(expectedVersion)}`,
        );
      }
      const current = requireRow();
      const next = applyAutomationControlPatch(current, patch, stamp());
      const result = update.run(
        next.enabled ? 1 : 0,
        next.authority,
        next.operatorHold ? 1 : 0,
        next.limit,
        next.maxIterations,
        next.maxCostUsd,
        next.perCandidateCeilingUsd,
        next.paidAuthorization ? 1 : 0,
        next.version,
        next.updatedAt,
        expectedVersion,
      );
      if (result.changes !== 1) {
        throw new AutomationControlStaleVersionError(expectedVersion, current.version);
      }
      return next;
    },
  };
}

function tableColumns(conn: DatabaseSync, table: string): Set<string> {
  const rows = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(conn: DatabaseSync, table: string, column: string, sqlType: string): void {
  if (!tableColumns(conn, table).has(column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
  }
}

function mapIssue(row: Record<string, unknown>): Issue {
  return {
    id: String(row.id),
    idea: String(row.idea),
    targetUrl: String(row.target_url),
    size: row.size as IssueSize,
    currentStage: row.current_stage as StageId,
    runMode: parseRunMode(row.run_mode ? String(row.run_mode) : "hitl"),
    walkHold: Boolean(row.walk_hold),
    oneshotStopReason: row.oneshot_stop_reason ? String(row.oneshot_stop_reason) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    cycleId: row.cycle_id ? String(row.cycle_id) : null,
    moduleId: row.module_id ? String(row.module_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    targetUrl: String(row.target_url),
    createdAt: String(row.created_at),
  };
}

function mapCycle(row: Record<string, unknown>): Cycle {
  return {
    id: String(row.id),
    name: String(row.name),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    status: row.status as CycleStatus,
    createdAt: String(row.created_at),
  };
}

function mapModule(row: Record<string, unknown>): Module {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

function mapTicket(row: Record<string, unknown>): DecisionTicket {
  return {
    id: String(row.id),
    issueId: String(row.issue_id),
    round: Number(row.round),
    prompt: String(row.prompt),
    recommendation: String(row.recommendation),
    priorMatch: row.prior_match ? String(row.prior_match) : null,
    answer: row.answer ? String(row.answer) : null,
  };
}

function mapStages(issueId: string): IssueStage[] {
  const stages = database()
    .prepare("SELECT * FROM issue_stages WHERE issue_id = ?")
    .all(issueId) as Record<string, unknown>[];
  return stages.map((stage) => ({
    issueId: String(stage.issue_id),
    stage: stage.stage as StageId,
    status: stage.status as StageStatus,
    skipReason: stage.skip_reason ? String(stage.skip_reason) : null,
  }));
}

function projectNameFromUrl(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? url.hostname;
    return last.replace(/\.git$/, "") || url.hostname;
  } catch {
    return targetUrl;
  }
}

export function listProjects(): Project[] {
  const rows = database().prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapProject);
}

export function getProject(id: string): Project | null {
  const row = database().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: { name: string; targetUrl: string }): Project {
  const now = new Date().toISOString();
  const existing = database()
    .prepare("SELECT * FROM projects WHERE target_url = ?")
    .get(input.targetUrl) as Record<string, unknown> | undefined;
  if (existing) return mapProject(existing);
  const id = randomUUID();
  database()
    .prepare("INSERT INTO projects (id, name, target_url, created_at) VALUES (?, ?, ?, ?)")
    .run(id, input.name, input.targetUrl, now);
  const created = getProject(id);
  if (!created) throw new Error("project missing after insert");
  return created;
}

export function ensureProjectForUrl(targetUrl: string): Project {
  return createProject({ name: projectNameFromUrl(targetUrl), targetUrl });
}

export function listCycles(): Cycle[] {
  const rows = database().prepare("SELECT * FROM cycles ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapCycle);
}

export function getCycle(id: string): Cycle | null {
  const row = database().prepare("SELECT * FROM cycles WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapCycle(row) : null;
}

export function createCycle(input: { name: string; startsAt: string; endsAt: string; status?: CycleStatus }): Cycle {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = input.status ?? "active";
  database()
    .prepare(
      "INSERT INTO cycles (id, name, starts_at, ends_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, input.name, input.startsAt, input.endsAt, status, now);
  const created = getCycle(id);
  if (!created) throw new Error("cycle missing after insert");
  return created;
}

export function listModules(projectId?: string): Module[] {
  const rows = projectId
    ? (database()
        .prepare("SELECT * FROM modules WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId) as Record<string, unknown>[])
    : (database().prepare("SELECT * FROM modules ORDER BY created_at DESC").all() as Record<
        string,
        unknown
      >[]);
  return rows.map(mapModule);
}

export function getModule(id: string): Module | null {
  const row = database().prepare("SELECT * FROM modules WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapModule(row) : null;
}

export function createModule(input: { projectId: string; name: string }): Module {
  const id = randomUUID();
  const now = new Date().toISOString();
  database()
    .prepare("INSERT INTO modules (id, project_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, input.projectId, input.name, now);
  const created = getModule(id);
  if (!created) throw new Error("module missing after insert");
  return created;
}

export function listIssues(): Issue[] {
  const rows = database().prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapIssue);
}

export function listIssuesByProject(projectId: string): Issue[] {
  const rows = database()
    .prepare("SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listIssuesByCycle(cycleId: string): Issue[] {
  const rows = database()
    .prepare("SELECT * FROM issues WHERE cycle_id = ? ORDER BY created_at DESC")
    .all(cycleId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listIssuesByModule(moduleId: string): Issue[] {
  const rows = database()
    .prepare("SELECT * FROM issues WHERE module_id = ? ORDER BY created_at DESC")
    .all(moduleId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listGateIssues(): Issue[] {
  return listIssues().filter((issue) => {
    if (gateFor(issue.currentStage) === null) return false;
    if (isOneshotWalking(issue)) return false;
    return true;
  });
}

export function getIssue(id: string): { issue: Issue; stages: IssueStage[] } | null {
  const row = database().prepare("SELECT * FROM issues WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return { issue: mapIssue(row), stages: mapStages(id) };
}

export function createIssue(input: {
  idea: string;
  targetUrl: string;
  size: IssueSize;
  runMode?: RunMode;
  projectId?: string | null;
  cycleId?: string | null;
  moduleId?: string | null;
}): Issue {
  const id = randomUUID();
  const now = new Date().toISOString();
  const runMode = parseRunMode(input.runMode);
  const skips = skippedStages(input.size);
  const first = STAGES.find((stage) => stage !== "intake" && !(stage in skips)) ?? "research";
  const project = input.projectId
    ? (getProject(input.projectId) ?? ensureProjectForUrl(input.targetUrl))
    : ensureProjectForUrl(input.targetUrl);
  const projectId = project.id;
  const conn = database();
  conn.exec("BEGIN");
  try {
    conn
      .prepare(
        "INSERT INTO issues (id, idea, target_url, size, current_stage, created_at, updated_at, project_id, cycle_id, module_id, run_mode, walk_hold, oneshot_stop_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)",
      )
      .run(
        id,
        input.idea,
        input.targetUrl,
        input.size,
        first,
        now,
        now,
        projectId,
        input.cycleId ?? null,
        input.moduleId ?? null,
        runMode,
      );
    for (const stage of STAGES) {
      const skipReason = skips[stage] ?? null;
      let status: StageStatus = "pending";
      if (skipReason) status = "skipped";
      else if (stage === "intake") status = "done";
      else if (stage === first) status = "active";
      conn
        .prepare("INSERT INTO issue_stages (issue_id, stage, status, skip_reason) VALUES (?, ?, ?, ?)")
        .run(id, stage, status, skipReason);
    }
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  appendEvent(id, "issue.created", {
    size: input.size,
    targetUrl: input.targetUrl,
    currentStage: first,
    projectId,
    runMode,
  });
  const created = getIssue(id);
  if (!created) throw new Error("issue missing after insert");
  return created.issue;
}

export function assignIssue(
  issueId: string,
  input: { projectId?: string | null; cycleId?: string | null; moduleId?: string | null },
): Issue {
  const loaded = getIssue(issueId);
  if (!loaded) throw new Error("unknown issue");
  const now = new Date().toISOString();
  database()
    .prepare(
      "UPDATE issues SET project_id = COALESCE(?, project_id), cycle_id = COALESCE(?, cycle_id), module_id = COALESCE(?, module_id), updated_at = ? WHERE id = ?",
    )
    .run(input.projectId ?? null, input.cycleId ?? null, input.moduleId ?? null, now, issueId);
  const updated = getIssue(issueId);
  if (!updated) throw new Error("issue missing after assign");
  appendEvent(issueId, "issue.assigned", {
    projectId: updated.issue.projectId,
    cycleId: updated.issue.cycleId,
    moduleId: updated.issue.moduleId,
  });
  return updated.issue;
}

export function completeActiveStage(
  issueId: string,
  actor: EventActor = { source: "system", reason: "auto-complete" },
): Issue {
  const loaded = getIssue(issueId);
  if (!loaded) throw new Error("unknown issue");
  const conn = database();
  const now = new Date().toISOString();
  const current = loaded.issue.currentStage;
  conn.exec("BEGIN");
  try {
    conn.prepare("UPDATE issue_stages SET status = ? WHERE issue_id = ? AND stage = ?").run("done", issueId, current);
    const next = STAGES.find((stage) => {
      const row = loaded.stages.find((item) => item.stage === stage);
      return row && row.status !== "skipped" && row.status !== "done" && stage !== current;
    });
    if (next) {
      conn.prepare("UPDATE issue_stages SET status = ? WHERE issue_id = ? AND stage = ?").run("active", issueId, next);
      conn.prepare("UPDATE issues SET current_stage = ?, updated_at = ? WHERE id = ?").run(next, now, issueId);
    } else {
      conn.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(now, issueId);
    }
    conn.exec("COMMIT");
    appendEvent(issueId, "stage.completed", { stage: current, next: next ?? null }, actor);
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  const updated = getIssue(issueId);
  if (!updated) throw new Error("issue missing after update");
  return updated.issue;
}

function mapJob(row: Record<string, unknown>): IssueJob {
  const startedAt = String(row.started_at);
  return {
    issueId: String(row.issue_id),
    stage: row.stage as StageId,
    status: row.status as JobStatus,
    error: row.error ? String(row.error) : null,
    startedAt,
    heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : startedAt,
    attempts: Number(row.attempts ?? 1),
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : null,
    retryable: Boolean(row.retryable),
  };
}

function mapArtifact(row: Record<string, unknown>): IssueArtifact {
  return {
    issueId: String(row.issue_id),
    kind: String(row.kind),
    stage: row.stage as StageId,
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

export function getJob(issueId: string, stage: StageId): IssueJob | null {
  const row = database()
    .prepare("SELECT * FROM issue_jobs WHERE issue_id = ? AND stage = ?")
    .get(issueId, stage) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export function listJobs(): IssueJob[] {
  const rows = database()
    .prepare("SELECT * FROM issue_jobs ORDER BY started_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(mapJob);
}

export function getArtifact(issueId: string, kind: string): IssueArtifact | null {
  const row = database()
    .prepare("SELECT * FROM issue_artifacts WHERE issue_id = ? AND kind = ?")
    .get(issueId, kind) as Record<string, unknown> | undefined;
  return row ? mapArtifact(row) : null;
}

export function listArtifacts(issueId: string): IssueArtifact[] {
  const rows = database()
    .prepare("SELECT * FROM issue_artifacts WHERE issue_id = ? ORDER BY created_at DESC")
    .all(issueId) as Record<string, unknown>[];
  return rows.map(mapArtifact);
}

export function saveArtifact(input: {
  issueId: string;
  kind: string;
  stage: StageId;
  body: string;
}): IssueArtifact {
  const now = new Date().toISOString();
  database()
    .prepare(
      "INSERT OR REPLACE INTO issue_artifacts (issue_id, kind, stage, body, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.issueId, input.kind, input.stage, input.body, now);
  const saved = getArtifact(input.issueId, input.kind);
  if (!saved) throw new Error("artifact missing after save");
  return saved;
}

export function tryClaimJob(issueId: string, stage: StageId, startedAt?: string): boolean {
  const now = startedAt ?? new Date().toISOString();
  const result = database()
    .prepare(
      "INSERT OR IGNORE INTO issue_jobs (issue_id, stage, status, error, started_at, heartbeat_at, attempts, next_retry_at, retryable) VALUES (?, ?, ?, NULL, ?, ?, 1, NULL, 0)",
    )
    .run(issueId, stage, "running", now, now);
  if (result.changes > 0) return true;
  const updated = database()
    .prepare(
      "UPDATE issue_jobs SET status = ?, error = NULL, heartbeat_at = ?, attempts = attempts + 1, next_retry_at = NULL, retryable = 0 WHERE issue_id = ? AND stage = ? AND status <> ?",
    )
    .run("running", now, issueId, stage, "running");
  return updated.changes > 0;
}

export function failJob(issueId: string, stage: StageId, error: string): void {
  database()
    .prepare("UPDATE issue_jobs SET status = ?, error = ? WHERE issue_id = ? AND stage = ?")
    .run("failed", error, issueId, stage);
}

export function scheduleJobRetry(
  issueId: string,
  stage: StageId,
  error: string,
  nextRetryAt: string | null,
  retryable: boolean,
): void {
  database()
    .prepare(
      "UPDATE issue_jobs SET status = ?, error = ?, next_retry_at = ?, retryable = ? WHERE issue_id = ? AND stage = ?",
    )
    .run("failed", error, nextRetryAt, retryable ? 1 : 0, issueId, stage);
}

export function updateJobHeartbeat(issueId: string, stage: StageId): void {
  database()
    .prepare("UPDATE issue_jobs SET heartbeat_at = ? WHERE issue_id = ? AND stage = ?")
    .run(new Date().toISOString(), issueId, stage);
}

export function resetJobAttempts(issueId: string, stage: StageId): void {
  database()
    .prepare("UPDATE issue_jobs SET attempts = 1, next_retry_at = NULL, retryable = 0 WHERE issue_id = ? AND stage = ?")
    .run(issueId, stage);
}

export function listStaleJobs(): IssueJob[] {
  const rows = database()
    .prepare(
      "SELECT * FROM issue_jobs WHERE status = ? AND retryable = 0 AND next_retry_at IS NULL",
    )
    .all("stale") as Record<string, unknown>[];
  return rows.map(mapJob);
}

export function listDueRetries(now: string): IssueJob[] {
  const rows = database()
    .prepare(
      "SELECT * FROM issue_jobs WHERE retryable = 1 AND next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY next_retry_at ASC",
    )
    .all(now) as Record<string, unknown>[];
  return rows.map(mapJob);
}

export function markJobStale(issueId: string, stage: StageId): void {
  database()
    .prepare("UPDATE issue_jobs SET status = ?, error = COALESCE(error, ?) WHERE issue_id = ? AND stage = ?")
    .run("stale", "Worker stopped reporting", issueId, stage);
}

export function clearJob(issueId: string, stage: StageId): void {
  database().prepare("DELETE FROM issue_jobs WHERE issue_id = ? AND stage = ?").run(issueId, stage);
}

export function reconcileStaleJobs(maxAgeMs: number = STALE_JOB_MS): number {
  const cutoff = Date.now() - maxAgeMs;
  const rows = database()
    .prepare(
      "SELECT issue_id, stage, error FROM issue_jobs WHERE status = ? AND heartbeat_at <= ?",
    )
    .all("running", new Date(cutoff).toISOString()) as Record<string, unknown>[];
  for (const row of rows) {
    markJobStale(String(row.issue_id), row.stage as StageId);
  }
  return rows.length;
}

export function listDecisionTickets(issueId: string): DecisionTicket[] {
  const rows = database()
    .prepare("SELECT * FROM decision_tickets WHERE issue_id = ? ORDER BY round ASC, id ASC")
    .all(issueId) as Record<string, unknown>[];
  return rows.map(mapTicket);
}

export function saveDecisionTickets(
  issueId: string,
  tickets: Array<{ prompt: string; recommendation: string; priorMatch: string | null }>,
  round: number,
): DecisionTicket[] {
  const conn = database();
  conn.exec("BEGIN");
  try {
    for (const ticket of tickets) {
      const id = randomUUID();
      conn
        .prepare(
          "INSERT INTO decision_tickets (id, issue_id, round, prompt, recommendation, prior_match, answer) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        )
        .run(id, issueId, round, ticket.prompt, ticket.recommendation, ticket.priorMatch);
    }
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  appendEvent(issueId, "grill.tickets", { round, count: tickets.length });
  return listDecisionTickets(issueId);
}

export function answerDecisionTicket(id: string, answer: string): DecisionTicket {
  const row = database().prepare("SELECT * FROM decision_tickets WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("unknown Decision ticket");
  database().prepare("UPDATE decision_tickets SET answer = ? WHERE id = ?").run(answer, id);
  const updated = database().prepare("SELECT * FROM decision_tickets WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  appendEvent(String(row.issue_id), "grill.answered", { ticketId: id });
  return mapTicket(updated);
}

export function unansweredTicketCount(issueId: string): number {
  const tickets = listDecisionTickets(issueId);
  return tickets.filter((ticket) => !ticket.answer).length;
}

export function isGrillHeld(issueId: string): boolean {
  const row = database().prepare("SELECT grill_hold FROM issues WHERE id = ?").get(issueId) as
    | { grill_hold: number | null }
    | undefined;
  return Boolean(row?.grill_hold);
}

export function setGrillHold(issueId: string, held: boolean): void {
  const now = new Date().toISOString();
  database()
    .prepare("UPDATE issues SET grill_hold = ?, updated_at = ? WHERE id = ?")
    .run(held ? 1 : 0, now, issueId);
  appendEvent(
    issueId,
    held ? "grill.hold" : "grill.hold_released",
    {},
    { source: "operator", reason: held ? "hold" : undefined },
  );
}

export function isWalkHeld(issueId: string): boolean {
  const loaded = getIssue(issueId);
  return Boolean(loaded?.issue.walkHold);
}

export function setWalkHold(issueId: string, held: boolean): void {
  const loaded = getIssue(issueId);
  if (!loaded) throw new Error("unknown issue");
  const now = new Date().toISOString();
  database()
    .prepare("UPDATE issues SET walk_hold = ?, updated_at = ? WHERE id = ?")
    .run(held ? 1 : 0, now, issueId);
  appendEvent(
    issueId,
    held ? "oneshot.paused" : "oneshot.resumed",
    {},
    { source: "operator", reason: held ? "pause" : "resume" },
  );
}

export function setOneshotStopReason(issueId: string, reason: string | null): void {
  const now = new Date().toISOString();
  database()
    .prepare("UPDATE issues SET oneshot_stop_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason, now, issueId);
}

export function cancelOneshot(issueId: string): void {
  const loaded = getIssue(issueId);
  if (!loaded) throw new Error("unknown issue");
  const now = new Date().toISOString();
  database()
    .prepare(
      "UPDATE issues SET run_mode = ?, walk_hold = 0, oneshot_stop_reason = NULL, updated_at = ? WHERE id = ?",
    )
    .run("hitl", now, issueId);
  appendEvent(issueId, "oneshot.cancelled", {}, { source: "operator", reason: "cancel" });
}

export function clearTicketAnswer(id: string): DecisionTicket {
  const row = database().prepare("SELECT * FROM decision_tickets WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("unknown Decision ticket");
  database().prepare("UPDATE decision_tickets SET answer = NULL WHERE id = ?").run(id);
  const updated = database().prepare("SELECT * FROM decision_tickets WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  appendEvent(String(row.issue_id), "grill.reopened", { ticketId: id }, { source: "operator", reason: "reopen" });
  return mapTicket(updated);
}

export function currentGrillRound(issueId: string): number {
  const tickets = listDecisionTickets(issueId);
  if (tickets.length === 0) return 0;
  return Math.max(...tickets.map((ticket) => ticket.round));
}

export function navCounts(): NavCounts {
  return {
    issues: listIssues().length,
    gates: listGateIssues().length,
    workers: listJobs().filter((job) => job.status !== "running").length,
    projects: listProjects().length,
    cycles: listCycles().length,
    modules: listModules().length,
  };
}

/**
 * Durable SQLite-backed `SupervisorStoreAdapter` for the automation
 * supervisor. Every operation is a single synchronous compare-and-set
 * statement against `supervisor_lease` / `supervisor_ticks`, so the CAS
 * guards (no held lease, expired lease, owner match, unique tick id) hold
 * atomically even across independent connections to the same database.
 *
 * `connection` is the shared Foundry connection by default; callers that need
 * a second independent connection (tests, multi-instance supervision) may
 * inject one. `now` is the wall clock used for takeover-expiry and release
 * stamps; inject it to make the adapter deterministic.
 */
export function createSupervisorStore(
  options: { now?: () => string; connection?: DatabaseSync } = {},
): SupervisorStoreAdapter {
  const conn = options.connection ?? database();
  conn.exec(SUPERVISOR_SCHEMA);
  const stamp = options.now ?? (() => new Date().toISOString());

  const mapLease = (row: {
    lease_id: string;
    owner: string;
    tick_id: string;
    acquired_at: string;
    expires_at: string;
    released_at: string | null;
  }): SupervisorLease => ({
    id: row.lease_id,
    owner: row.owner,
    tickId: row.tick_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
  });

  return {
    getLease: () => {
      const row = conn
        .prepare("SELECT lease_id, owner, tick_id, acquired_at, expires_at, released_at FROM supervisor_lease WHERE id = 1")
        .get() as
        | { lease_id: string; owner: string; tick_id: string; acquired_at: string; expires_at: string; released_at: string | null }
        | undefined;
      return row ? mapLease(row) : null;
    },

    acquireLease: (lease) => {
      const updated = conn
        .prepare(
          `UPDATE supervisor_lease SET lease_id = ?, owner = ?, tick_id = ?, acquired_at = ?, expires_at = ?, released_at = NULL
           WHERE id = 1 AND released_at IS NOT NULL`,
        )
        .run(lease.id, lease.owner, lease.tickId, lease.acquiredAt, lease.expiresAt);
      if (updated.changes === 1) return true;
      const inserted = conn
        .prepare(
          `INSERT OR IGNORE INTO supervisor_lease (id, lease_id, owner, tick_id, acquired_at, expires_at, released_at)
           VALUES (1, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(lease.id, lease.owner, lease.tickId, lease.acquiredAt, lease.expiresAt);
      return inserted.changes === 1;
    },

    takeOverLease: (expectedLeaseId, replacementLease) => {
      const updated = conn
        .prepare(
          `UPDATE supervisor_lease SET lease_id = ?, owner = ?, tick_id = ?, acquired_at = ?, expires_at = ?, released_at = NULL
           WHERE id = 1 AND lease_id = ? AND released_at IS NULL AND expires_at <= ?`,
        )
        .run(
          replacementLease.id,
          replacementLease.owner,
          replacementLease.tickId,
          replacementLease.acquiredAt,
          replacementLease.expiresAt,
          expectedLeaseId,
          stamp(),
        );
      return updated.changes === 1;
    },

    renewLease: (id, owner, expiresAt) => {
      const updated = conn
        .prepare(
          `UPDATE supervisor_lease SET expires_at = ?
           WHERE id = 1 AND lease_id = ? AND owner = ? AND released_at IS NULL AND expires_at > ?`,
        )
        .run(expiresAt, id, owner, stamp());
      return updated.changes === 1;
    },

    isLeaseLive: (id, owner) => {
      const row = conn
        .prepare(
          `SELECT 1 FROM supervisor_lease
           WHERE id = 1 AND lease_id = ? AND owner = ? AND released_at IS NULL AND expires_at > ?`,
        )
        .get(id, owner, stamp());
      return row !== undefined;
    },

    withLiveLease: (id, owner, mutate) => {
      // BEGIN IMMEDIATE takes the write lock, so no other connection can
      // release, expire, or take over the lease while we are inside: the
      // lease-live predicate and the mutation commit as one unit. A stale
      // owner's mutation is never admitted.
      conn.exec("BEGIN IMMEDIATE");
      try {
        const live = conn
          .prepare(
            `SELECT 1 FROM supervisor_lease
             WHERE id = 1 AND lease_id = ? AND owner = ? AND released_at IS NULL AND expires_at > ?`,
          )
          .get(id, owner, stamp());
        if (live === undefined) {
          conn.exec("ROLLBACK");
          return { admitted: false } as const;
        }
        const value = mutate();
        conn.exec("COMMIT");
        return { admitted: true, value };
      } catch (error) {
        try {
          conn.exec("ROLLBACK");
        } catch {
          // The failure already ended the transaction; nothing left to undo.
        }
        throw error;
      }
    },

    releaseLease: (id, owner) => {
      const updated = conn
        .prepare(
          `UPDATE supervisor_lease SET released_at = ?
           WHERE id = 1 AND lease_id = ? AND owner = ? AND released_at IS NULL`,
        )
        .run(stamp(), id, owner);
      return updated.changes === 1;
    },

    isTickRecorded: (tickId) => {
      const row = conn.prepare("SELECT 1 FROM supervisor_ticks WHERE tick_id = ?").get(tickId);
      return row !== undefined;
    },

    recordTick: (event: SupervisorTickEvent) => {
      conn
        .prepare(
          `INSERT OR IGNORE INTO supervisor_ticks (tick_id, owner, outcome, reason, at, previous_owner)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(event.tickId, event.owner, event.outcome, event.reason, event.at, event.previousOwner);
    },
  };
}

/**
 * Derive the closed `AuthorityProfile` for a supervisor tick from the durable
 * operator authority on `automation_control`, exactly:
 *   observe -> observe granted only
 *   build   -> observe + build granted
 *   publish -> observe + build + publish granted
 * Every other scope is explicitly denied. The profile is derived, never
 * injected, so an `AuthorityProfile` can never disagree with the durable
 * control row the runtime consults.
 */
export function supervisorAuthorityProfileFromControl(
  authority: AutomationAuthority,
  now: string,
): AuthorityProfile {
  const base = defaultAuthorityProfile(now);
  const grant = (scope: AuthorityScope) => ({
    granted: true,
    reason: `derived from durable control authority ${authority}`,
  });
  switch (authority) {
    case "observe":
      return applyAuthorityProfilePatch(base, { observe: grant("observe") }, now);
    case "build":
      return applyAuthorityProfilePatch(
        base,
        { observe: grant("observe"), build: grant("build") },
        now,
      );
    case "publish":
      return applyAuthorityProfilePatch(
        base,
        { observe: grant("observe"), build: grant("build"), publish: grant("publish") },
        now,
      );
  }
}

/** The caller-invoked production seam for one durable supervision tick. The
 *  authority profile is derived from the durable control row, so it is not
 *  part of the input. */
export type SupervisorRuntimeTickInput = Omit<SupervisorTickInput, "store" | "now" | "authority">;

/** A supervisor wired to its durable store. There is no daemon: a tick runs
 *  only when a caller invokes `tick`, and the injected policy is disabled by
 *  default, so nothing runs unless an operator enables it and calls. */
export type SupervisorRuntime = {
  store: SupervisorStoreAdapter;
  tick: (input: SupervisorRuntimeTickInput) => Promise<SupervisorTickResult>;
};

/** Build a supervisor runtime wired to the durable SQLite store. The store
 *  and the tick share one clock (`now`), so takeover-expiry checks and the
 *  tick's own timestamps stay consistent. The authority profile is derived
 *  from `input.control.get().authority` at tick time — never injected.
 *
 *  The seam always supplies the mid-pass renewal sleep (a real timer by
 *  default), so a caller cannot disable renewal by omission; only the
 *  operator policy `renewDuringPass: false` turns it off. Tests may inject a
 *  fast `sleep` so the 30s renewal timer does not keep the harness alive. */
export function createSupervisorRuntime(
  options: { now?: () => string; connection?: DatabaseSync; sleep?: (ms: number) => Promise<void> } = {},
): SupervisorRuntime {
  const stamp = options.now ?? (() => new Date().toISOString());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const store = createSupervisorStore({ ...options, now: stamp });
  return {
    store,
    tick: (input) =>
      runSupervisorTick({
        ...input,
        store,
        now: stamp,
        sleep,
        authority: supervisorAuthorityProfileFromControl(input.control.get().authority, stamp()),
      }),
  };
}