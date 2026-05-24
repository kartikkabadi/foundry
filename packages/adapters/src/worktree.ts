import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class WorktreeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeAdapterError';
  }
}

function normalizePath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return resolve(candidate);
  }
}

function git(projectRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorktreeAdapterError(`git ${args.join(' ')} failed: ${message}`);
  }
}

export function createWorktree(
  projectRoot: string,
  branch: string,
  worktreePath: string,
): WorktreeInfo {
  git(projectRoot, ['worktree', 'add', '-B', branch, worktreePath]);
  const head = git(worktreePath, ['rev-parse', 'HEAD']);
  return { path: worktreePath, branch, head };
}

export function listWorktrees(projectRoot: string): WorktreeInfo[] {
  const output = git(projectRoot, ['worktree', 'list', '--porcelain']);
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path && current.branch && current.head) {
        entries.push(current as WorktreeInfo);
      }
      current = { path: normalizePath(line.slice('worktree '.length)) };
      continue;
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
      continue;
    }
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    }
  }

  if (current.path && current.branch && current.head) {
    entries.push(current as WorktreeInfo);
  }

  return entries;
}

export function listFoundryWorktrees(projectRoot: string, prefix = 'foundry-build-'): WorktreeInfo[] {
  return listWorktrees(projectRoot).filter((entry) => entry.branch.startsWith(prefix));
}

export function removeWorktree(projectRoot: string, worktreePath: string, branch?: string): void {
  if (!existsSync(worktreePath)) {
    return;
  }

  git(projectRoot, ['worktree', 'remove', '--force', worktreePath]);

  if (branch) {
    try {
      git(projectRoot, ['branch', '-D', branch]);
    } catch {
      // branch may already be gone
    }
  }
}

export function cleanupFoundryWorktrees(projectRoot: string, prefix = 'foundry-build-'): string[] {
  const removed: string[] = [];
  for (const entry of listFoundryWorktrees(projectRoot, prefix)) {
    removeWorktree(projectRoot, entry.path, entry.branch);
    removed.push(entry.path);
  }
  return removed;
}

export function defaultWorktreePath(projectRoot: string, issueNumber: number): string {
  const root = normalizePath(projectRoot);
  return resolve(root, '.worktrees', `foundry-build-${issueNumber}`);
}

export function defaultWorktreeBranch(issueNumber: number): string {
  return `foundry-build-${issueNumber}`;
}

export function ensureWorktreeParent(projectRoot: string): string {
  const parent = join(projectRoot, '.worktrees');
  if (!existsSync(parent)) {
    execFileSync('mkdir', ['-p', parent], { cwd: projectRoot });
  }
  return parent;
}

export function forceRemoveWorktreeDir(worktreePath: string): void {
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}
