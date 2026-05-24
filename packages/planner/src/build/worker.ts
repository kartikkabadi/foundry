import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createWorktree,
  defaultWorktreeBranch,
  defaultWorktreePath,
  ensureWorktreeParent,
} from '@foundry/adapters/worktree.js';
import type { BuildIssueState, IssuePlanNode, ProofType } from '@foundry/core/types/build.js';
import {
  auditAutonomyEvent,
  evaluateAutonomyAction,
  loadAutonomyProfileFromRun,
} from './autonomy.js';
import { defaultProofEvidence, writeProofJson } from './proof-registry.js';
import { enterReviewGate, approveReview } from './review.js';

export interface BuildWorkerDeps {
  runAgent: (options: {
    issue: IssuePlanNode;
    worktreePath: string;
    projectRoot: string;
  }) => Promise<{ outputFile: string; attemptedInstall?: boolean }>;
  autoApproveReview?: boolean;
}

export class BuildWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildWorkerError';
  }
}

export interface WorkerResult {
  issue: BuildIssueState;
  proofPath: string;
  build: import('@foundry/core/types/build.js').BuildState;
}

export async function executeIssueWorker(options: {
  projectRoot: string;
  runDir: string;
  issue: IssuePlanNode;
  build: import('@foundry/core/types/build.js').BuildState;
  deps: BuildWorkerDeps;
}): Promise<WorkerResult> {
  const { projectRoot, runDir, issue, build, deps } = options;
  ensureWorktreeParent(projectRoot);

  const worktreePath = defaultWorktreePath(projectRoot, issue.number);
  const branch = defaultWorktreeBranch(issue.number);
  createWorktree(projectRoot, branch, worktreePath);

  const profile = loadAutonomyProfileFromRun(runDir);
  const installDecision = evaluateAutonomyAction(profile, 'npm_install');
  auditAutonomyEvent(runDir, installDecision);
  if (!installDecision.allowed) {
    throw new BuildWorkerError(installDecision.reason);
  }

  const agentResult = await deps.runAgent({
    issue,
    worktreePath,
    projectRoot,
  });

  if (agentResult.attemptedInstall && !installDecision.allowed) {
    throw new BuildWorkerError('Worker attempted npm install without approval');
  }

  const commitDecision = evaluateAutonomyAction(profile, 'git_commit');
  auditAutonomyEvent(runDir, commitDecision);
  if (!commitDecision.allowed) {
    throw new BuildWorkerError(commitDecision.reason);
  }

  const proofPath = writeProofJson(runDir, {
    issue: issue.number,
    type: issue.type,
    summary: `Completed issue #${issue.number}: ${issue.title}`,
    evidence: proofEvidenceFromAgent(issue.type, agentResult.outputFile),
  });

  let updatedBuild = enterReviewGate(build, issue.number);
  const issueState: BuildIssueState = {
    number: issue.number,
    title: issue.title,
    type: issue.type,
    status: 'awaiting_review',
    worktree: worktreePath,
    blocked_by: issue.blocked_by,
  };

  if (deps.autoApproveReview) {
    updatedBuild = approveReview(updatedBuild, issue.number);
    issueState.status = 'completed';
  }

  updatedBuild = {
    ...updatedBuild,
    issues: updatedBuild.issues.map((entry) =>
      entry.number === issue.number ? issueState : entry,
    ),
  };

  return { issue: issueState, proofPath, build: updatedBuild };
}

export function proofEvidenceFromAgent(
  type: import('@foundry/core/types/build.js').ProofType,
  outputFile: string,
): Record<string, unknown> {
  const base = defaultProofEvidence(type);
  if (!existsSync(outputFile)) {
    return base;
  }
  const summary = readFileSync(outputFile, 'utf8').trim().slice(0, 500);
  return {
    ...base,
    agent_output_file: outputFile,
    agent_summary: summary.length > 0 ? summary : '(empty)',
  };
}

export function mockAgentWriteFile(options: {
  issue: IssuePlanNode;
  worktreePath: string;
}): { outputFile: string; attemptedInstall?: boolean } {
  const outputFile = join(options.worktreePath, `foundry-issue-${options.issue.number}.txt`);
  writeFileSync(
    outputFile,
    `Mock worker output for issue #${options.issue.number}: ${options.issue.title}\n`,
    'utf8',
  );
  return { outputFile, attemptedInstall: false };
}

export function mockAgentWithInstall(options: {
  issue: IssuePlanNode;
  worktreePath: string;
}): { outputFile: string; attemptedInstall: boolean } {
  const result = mockAgentWriteFile(options);
  return { ...result, attemptedInstall: true };
}

export function issueTypeFromNode(node: IssuePlanNode): ProofType {
  return node.type;
}
