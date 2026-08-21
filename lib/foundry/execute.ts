import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import "eve/client";
import { runStructured } from "./eve-session";
import { appendEvent } from "./log";
import { parseResearchBrief } from "./research";
import { parseSpec } from "./spec";
import {
  clearJob,
  failJob,
  getArtifact,
  getIssue,
  saveArtifact,
  tryClaimJob,
} from "./store";
import { ARTIFACT_KIND, type ExecuteResult, type Issue, type StageId } from "./types";

const executeSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    }),
  ),
  branchName: z.string(),
  commitMessage: z.string(),
  prTitle: z.string(),
  prBody: z.string(),
});

const executeResultSchema = z.object({
  prUrl: z.string(),
  branchName: z.string(),
  commitMessage: z.string(),
  diff: z.string(),
  testResults: z.string(),
  filesChanged: z.array(z.string()),
});

type ExecuteResultShape = z.infer<typeof executeResultSchema>;

const inflight = (globalThis as typeof globalThis & {
  __foundryExecute?: Map<string, Promise<void>>;
}).__foundryExecute ??= new Map();

export function executeInflight(issueId: string): boolean {
  return inflight.has(issueId);
}

export function startExecute(issueId: string): void {
  if (inflight.has(issueId)) return;
  const work = runExecute(issueId).finally(() => {
    inflight.delete(issueId);
  });
  inflight.set(issueId, work);
}

export async function runExecute(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded || loaded.issue.currentStage !== "execute") return;
  if (getArtifact(issueId, ARTIFACT_KIND.execute)) return;
  if (!tryClaimJob(issueId, "execute")) return;
  appendEvent(issueId, "execute.started", {});
  try {
    const specArtifact = getArtifact(issueId, ARTIFACT_KIND.spec);
    const spec = specArtifact ? parseSpec(specArtifact.body) : null;
    if (!spec) {
      throw new Error("No spec artifact found for execute stage");
    }
    const workDir = join(process.cwd(), "data", "worktrees", issueId);
    if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
    mkdirSync(workDir, { recursive: true });
    cloneRepo(loaded.issue.targetUrl, workDir);
    const branchName = `foundry/${issueId}-${Date.now()}`;
    execFileSync("git", ["checkout", "-b", branchName], { cwd: workDir });
    const result = await generateCode(loaded.issue, spec, workDir);
    writeFiles(workDir, result.files);
    execFileSync("git", ["add", "."], { cwd: workDir });
    execFileSync("git", ["commit", "-m", result.commitMessage], { cwd: workDir });
    const testResults = runTests(workDir);
    const prResult = createPR(
      workDir,
      branchName,
      result.prTitle,
      result.prBody,
    );
    const diff = getDiff(workDir);
    const executeResult: ExecuteResult = {
      prUrl: prResult.url,
      branchName,
      commitMessage: result.commitMessage,
      diff,
      testResults,
      filesChanged: result.files.map((f) => f.path),
    };
    saveArtifact({
      issueId,
      kind: ARTIFACT_KIND.execute,
      stage: "execute",
      body: JSON.stringify(executeResult),
    });
    clearJob(issueId, "execute");
    appendEvent(issueId, "execute.completed", {
      prUrl: prResult.url,
      branchName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execute failed";
    failJob(issueId, "execute", message);
    appendEvent(issueId, "execute.failed", { error: message });
  }
}

function cloneRepo(targetUrl: string, workDir: string): void {
  execFileSync("git", ["clone", targetUrl, "."], { cwd: workDir });
}

function writeFiles(workDir: string, files: Array<{ path: string; content: string }>): void {
  for (const file of files) {
    const filePath = join(workDir, file.path);
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, file.content, "utf8");
  }
}

function runTests(workDir: string): string {
  const packageJsonPath = join(workDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return "No package.json found, skipping tests";
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.scripts?.test) {
      execFileSync("npm", ["test"], { cwd: workDir, stdio: "pipe" });
      return "Tests passed";
    }
    return "No test script found in package.json";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test execution failed";
    return `Tests failed: ${message}`;
  }
}

function createPR(
  workDir: string,
  branchName: string,
  prTitle: string,
  prBody: string,
): { url: string } {
  try {
    execFileSync("git", ["push", "origin", branchName], { cwd: workDir, stdio: "pipe" });
    const result = execFileSync(
      "gh",
      ["pr", "create", "--title", prTitle, "--body", prBody, "--base", "main", "--head", branchName],
      { cwd: workDir, encoding: "utf8", stdio: "pipe" },
    );
    const prUrl = result.trim();
    return { url: prUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PR creation failed";
    throw new Error(`Failed to create PR: ${message}`);
  }
}

function getDiff(workDir: string): string {
  try {
    return execFileSync("git", ["diff", "HEAD~1"], { cwd: workDir, encoding: "utf8" });
  } catch {
    return "Failed to get diff";
  }
}

async function generateCode(
  issue: Issue,
  spec: { title: string; spec: string; acceptance: string[] },
  workDir: string,
): Promise<z.infer<typeof executeSchema>> {
  const researchArtifact = getArtifact(issue.id, ARTIFACT_KIND.research);
  const research = researchArtifact ? parseResearchBrief(researchArtifact.body) : null;
  const repoContext = gatherRepoContext(workDir);
  return await runStructured(
    executeSchema,
    [
      "You are the execute stage of a HITL software factory. You write actual code.",
      "Generate the code changes needed to implement the spec.",
      "Return an object with: files (array of {path, content}), branchName, commitMessage, prTitle, prBody.",
      "",
      `Idea: ${issue.idea}`,
      `Target: ${issue.targetUrl}`,
      `Size: ${issue.size}`,
      "",
      `Spec: ${JSON.stringify(spec)}`,
      research ? `Research: ${JSON.stringify(research)}` : "",
      "",
      "Repository context:",
      repoContext,
    ].join("\n"),
    { issueId: issue.id, stage: "execute" },
  );
}

function gatherRepoContext(workDir: string): string {
  const chunks = ["Repository files from the cloned repo:"];
  for (const name of ["package.json", "README.md", "tsconfig.json"]) {
    const filePath = join(workDir, name);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf8").slice(0, 5000);
        chunks.push(`--- ${name} ---`, content);
      } catch {
        chunks.push(`--- ${name} ---`, "(unable to read)");
      }
    }
  }
  const fileList = execFileSync("git", ["ls-files"], { cwd: workDir, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 100);
  chunks.push("--- file list ---", fileList.join("\n") || "(empty)");
  return chunks.join("\n");
}

export function parseExecuteArtifact(body: string): ExecuteResult | null {
  try {
    const parsed = JSON.parse(body);
    return executeResultSchema.parse(parsed);
  } catch {
    return null;
  }
}
