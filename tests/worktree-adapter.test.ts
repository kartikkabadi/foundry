import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  cleanupFoundryWorktrees,
  createWorktree,
  defaultWorktreeBranch,
  defaultWorktreePath,
  listFoundryWorktrees,
  listWorktrees,
  removeWorktree,
} from '@foundry/adapters/worktree.js';
import { initGitRepo } from './build-fixtures.js';

describe('git worktree adapter (V3-3)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-worktree-'));
    initGitRepo(projectRoot);
  });

  afterEach(() => {
    try {
      cleanupFoundryWorktrees(projectRoot);
    } catch {
      // ignore cleanup errors in temp dirs
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('create/list/remove worktree roundtrip', () => {
    const branch = defaultWorktreeBranch(1);
    const worktreePath = defaultWorktreePath(projectRoot, 1);

    createWorktree(projectRoot, branch, worktreePath);
    assert.ok(fs.existsSync(worktreePath));

    const listed = listWorktrees(projectRoot);
    assert.ok(listed.some((entry) => entry.path === worktreePath));

    const foundryListed = listFoundryWorktrees(projectRoot);
    assert.strictEqual(foundryListed.length, 1);

    removeWorktree(projectRoot, worktreePath, branch);
    assert.ok(!fs.existsSync(worktreePath));
  });

  it('git worktree list works on temp repo', () => {
    execSync('git worktree list', { cwd: projectRoot, encoding: 'utf8' });
    assert.ok(listWorktrees(projectRoot).length >= 1);
  });
});
