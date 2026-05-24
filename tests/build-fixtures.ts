import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import type { CursorAdapter } from '@foundry/adapters/cursor.js';
import { createRun, initProject, type RunRef } from '@foundry/core/state/run-writer.js';

export const FIXTURE_ISSUE_PLAN = `# Issue plan

## Issue 1: Add CLI flag

Type: code
Blocked by:

Add --dry-run flag to build command.

## Issue 2: Update docs

Type: docs
Depends on: #1

Document build dry-run in README.
`;

export const FIXTURE_ISSUE_PLAN_CYCLE = `# Issue plan

## Issue 1: First

Type: code
Blocked by: #2

Cycle A.

## Issue 2: Second

Type: code
Blocked by: #1

Cycle B.
`;

export const FIXTURE_AUTONOMY_SAFE = `# Autonomy contract

default = "safe"

## Allowed by default
- Read local repo files
`;

export const FIXTURE_AUTONOMY_PRODUCTIVE = `# Autonomy contract

default = "productive"

## Allowed by default
- Package installs
- Commits
`;

export function initGitRepo(projectRoot: string): void {
  execSync('git init -q', { cwd: projectRoot });
  execSync('git config user.email "foundry@test.local"', { cwd: projectRoot });
  execSync('git config user.name "Foundry Test"', { cwd: projectRoot });
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Fixture\n', 'utf8');
  execSync('git add README.md', { cwd: projectRoot });
  execSync('git commit -q -m "init"', { cwd: projectRoot });
}

function ensureMockFoundryRoot(projectRoot: string): string {
  const root = path.join(projectRoot, '.mock-foundry-root');
  const distDir = path.join(root, 'packages', 'cli', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'cli.js'), '#!/usr/bin/env node\n', 'utf8');
  return root;
}

export function mockDoctorDeps(projectRoot: string): DoctorDeps {
  const root = ensureMockFoundryRoot(projectRoot);

  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'mock' };
    },
    async smokeComposerFast() {
      return { ok: true, message: 'mock fast' };
    },
  };

  return {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd: projectRoot,
    env: { CURSOR_API_KEY: 'test-key' },
    foundryRoot: root,
    piAuthPath: path.join(projectRoot, 'missing-auth.json'),
    exec(command: string, args: string[] = []) {
      if (command === 'npm') return { ok: true, stdout: '10.0.0', stderr: '' };
      if (command === 'pi') return { ok: true, stdout: 'pi 1.0.0', stderr: '' };
      if (command === 'git' && args[0] === 'worktree') {
        return { ok: true, stdout: '', stderr: '' };
      }
      if (command === 'which' && args[0] === 'pi') {
        return { ok: true, stdout: '/usr/local/bin/pi', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'not mocked' };
    },
    fileExists(p: string) {
      return fs.existsSync(p);
    },
    resolveModule(specifier: string) {
      return specifier === '@cursor/sdk';
    },
    cursorAdapter,
  };
}

export function seedApprovedBuildRun(
  projectRoot: string,
  foundryVersion = '0.1.0',
  issuePlan = FIXTURE_ISSUE_PLAN,
  autonomy = FIXTURE_AUTONOMY_PRODUCTIVE,
): RunRef {
  initProject(projectRoot);
  initGitRepo(projectRoot);

  const created = createRun(projectRoot, foundryVersion, {
    status: 'approved',
    phase: 'awaiting_approval',
    mode: 'plan',
  });

  fs.writeFileSync(path.join(created.runDir, 'issue-plan.md'), issuePlan, 'utf8');
  fs.writeFileSync(path.join(created.runDir, 'build-goal.md'), '# Build goal\n\nAll issues done.\n', 'utf8');
  fs.writeFileSync(path.join(created.runDir, 'autonomy-contract.md'), autonomy, 'utf8');

  return {
    ...created,
    run: { ...created.run, status: 'approved' },
  };
}
