import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { appendEvent } from "./log";
import { dbPath } from "./paths";
import {
  STAGES,
  skippedStages,
  type Issue,
  type IssueSize,
  type IssueStage,
  type StageId,
  type StageStatus,
} from "./types";

let db: DatabaseSync | null = null;

function database(): DatabaseSync {
  if (db) return db;
  const opened = new DatabaseSync(dbPath());
  opened.exec(`
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
  `);
  db = opened;
  return opened;
}

function mapIssue(row: Record<string, unknown>): Issue {
  return {
    id: String(row.id),
    idea: String(row.idea),
    targetUrl: String(row.target_url),
    size: row.size as IssueSize,
    currentStage: row.current_stage as StageId,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listIssues(): Issue[] {
  const rows = database().prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function getIssue(id: string): { issue: Issue; stages: IssueStage[] } | null {
  const row = database().prepare("SELECT * FROM issues WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const stages = database()
    .prepare("SELECT * FROM issue_stages WHERE issue_id = ?")
    .all(id) as Record<string, unknown>[];
  return {
    issue: mapIssue(row),
    stages: stages.map((stage) => ({
      issueId: String(stage.issue_id),
      stage: stage.stage as StageId,
      status: stage.status as StageStatus,
      skipReason: stage.skip_reason ? String(stage.skip_reason) : null,
    })),
  };
}

export function createIssue(input: { idea: string; targetUrl: string; size: IssueSize }): Issue {
  const id = randomUUID();
  const now = new Date().toISOString();
  const skips = skippedStages(input.size);
  const first =
    STAGES.find((stage) => stage !== "intake" && !(stage in skips)) ?? "research";
  const conn = database();
  conn.exec("BEGIN");
  try {
    conn
      .prepare(
        "INSERT INTO issues (id, idea, target_url, size, current_stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.idea, input.targetUrl, input.size, first, now, now);
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
  appendEvent(id, "issue.created", { size: input.size, targetUrl: input.targetUrl, currentStage: first });
  const created = getIssue(id);
  if (!created) throw new Error("issue missing after insert");
  return created.issue;
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
