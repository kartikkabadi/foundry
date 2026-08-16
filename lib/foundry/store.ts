import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { appendEvent } from "./log";
import { dbPath } from "./paths";
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
  type StageId,
  type StageStatus,
  gateFor,
} from "./types";

let db: DatabaseSync | null = null;

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
`;

function migrate(conn: DatabaseSync): void {
  ensureColumn(conn, "issues", "project_id", "TEXT");
  ensureColumn(conn, "issues", "cycle_id", "TEXT");
  ensureColumn(conn, "issues", "module_id", "TEXT");
  ensureColumn(conn, "issue_jobs", "heartbeat_at", "TEXT");
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
    db.exec(SCHEMA);
    migrate(db);
    backfillProjects(db);
  }
  return db;
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
  reconcileStaleJobs();
  const rows = database().prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapIssue);
}

export function listIssuesByProject(projectId: string): Issue[] {
  reconcileStaleJobs();
  const rows = database()
    .prepare("SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listIssuesByCycle(cycleId: string): Issue[] {
  reconcileStaleJobs();
  const rows = database()
    .prepare("SELECT * FROM issues WHERE cycle_id = ? ORDER BY created_at DESC")
    .all(cycleId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listIssuesByModule(moduleId: string): Issue[] {
  reconcileStaleJobs();
  const rows = database()
    .prepare("SELECT * FROM issues WHERE module_id = ? ORDER BY created_at DESC")
    .all(moduleId) as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function listGateIssues(): Issue[] {
  return listIssues().filter((issue) => gateFor(issue.currentStage) !== null);
}

export function getIssue(id: string): { issue: Issue; stages: IssueStage[] } | null {
  reconcileStaleJobs();
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
  projectId?: string | null;
  cycleId?: string | null;
  moduleId?: string | null;
}): Issue {
  const id = randomUUID();
  const now = new Date().toISOString();
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
        "INSERT INTO issues (id, idea, target_url, size, current_stage, created_at, updated_at, project_id, cycle_id, module_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

export function completeActiveStage(issueId: string): Issue {
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
    appendEvent(issueId, "stage.completed", { stage: current, next: next ?? null });
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
  reconcileStaleJobs();
  const row = database()
    .prepare("SELECT * FROM issue_jobs WHERE issue_id = ? AND stage = ?")
    .get(issueId, stage) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export function listJobs(): IssueJob[] {
  reconcileStaleJobs();
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
  database()
    .prepare(
      "INSERT OR REPLACE INTO issue_jobs (issue_id, stage, status, error, started_at, heartbeat_at) VALUES (?, ?, ?, NULL, ?, ?)",
    )
    .run(issueId, stage, "running", now, now);
  return true;
}

export function failJob(issueId: string, stage: StageId, error: string): void {
  database()
    .prepare("UPDATE issue_jobs SET status = ?, error = ? WHERE issue_id = ? AND stage = ?")
    .run("failed", error, issueId, stage);
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
    .prepare("SELECT * FROM issue_jobs WHERE status = ?")
    .all("running") as Record<string, unknown>[];
  let marked = 0;
  for (const row of rows) {
    const beat = Date.parse(String(row.heartbeat_at ?? row.started_at));
    if (!Number.isNaN(beat) && beat < cutoff) {
      markJobStale(String(row.issue_id), row.stage as StageId);
      marked += 1;
    }
  }
  return marked;
}

export function markStaleJobs(maxAgeMs: number = STALE_JOB_MS): number {
  return reconcileStaleJobs(maxAgeMs);
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

export function currentGrillRound(issueId: string): number {
  const tickets = listDecisionTickets(issueId);
  if (tickets.length === 0) return 0;
  return Math.max(...tickets.map((ticket) => ticket.round));
}

export function navCounts(): NavCounts {
  reconcileStaleJobs();
  return {
    issues: listIssues().length,
    gates: listGateIssues().length,
    workers: listJobs().filter((job) => job.status === "running" || job.status === "stale" || job.status === "failed")
      .length,
    projects: listProjects().length,
    cycles: listCycles().length,
    modules: listModules().length,
  };
}
