#!/usr/bin/env tsx
/**
 * CI-safe fixture plan smoke — runs executePlan with mock Composer (no network).
 * Usage: tsx scripts/fixture-plan-smoke.ts [projectRoot]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALGORITHM_PASS_ARTIFACTS, REQUIRED_SYNTHESIS_ARTIFACTS } from '@foundry/planner/plan/artifacts.js';
import { COVERAGE_SLOTS } from '@foundry/planner/plan/coverage-slots.js';
import { executePlan } from '@foundry/planner/plan/orchestrate.js';
import { initProject } from '@foundry/core/state/run-writer.js';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import type { CursorAdapter } from '@foundry/adapters/cursor.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-fixture-'));

function buildFakeIntent(): string {
  return COVERAGE_SLOTS.map((slot, i) => `## Slot ${i + 1}: ${slot}\n\nFixture intent.`).join('\n\n');
}

function buildDelimited(names: readonly string[]): string {
  return names
    .map((name) => {
      if (name === 'issue-plan.md') {
        return `---ARTIFACT: ${name}---
## Issue 1: Demo issue

Acceptance criteria for demo.

## Issue 2: Second demo issue

More AC.`;
      }
      return `---ARTIFACT: ${name}---\n# ${name}\n\nFixture content.`;
    })
    .join('\n\n');
}

function mockDoctorDeps(root: string): DoctorDeps {
  const distDir = path.join(repoRoot, 'packages', 'cli', 'dist');
  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'fixture mock' };
    },
  };

  return {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd: root,
    env: { CURSOR_API_KEY: 'fixture-key' },
    foundryRoot: repoRoot,
    piAuthPath: path.join(root, 'missing-auth.json'),
    exec(command: string, args: string[] = []) {
      if (command === 'npm') return { ok: true, stdout: '10.0.0', stderr: '' };
      if (command === 'pi') return { ok: true, stdout: 'pi 1.0.0', stderr: '' };
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

async function main(): Promise<void> {
  initProject(projectRoot);

  const fakePrompt = async (prompt: string) => {
    if (prompt.includes('research agent')) return '# Research\nFixture.';
    if (prompt.includes('intent interview')) return buildFakeIntent();
    if (prompt.includes('Algorithm Pass agent')) return buildDelimited(ALGORITHM_PASS_ARTIFACTS);
    if (prompt.includes('synthesis agent')) return buildDelimited(REQUIRED_SYNTHESIS_ARTIFACTS);
    return 'ok';
  };

  const ref = await executePlan({
    idea: 'CLI that converts markdown PRDs to GitHub issues',
    projectRoot,
    deps: {
      doctorDeps: mockDoctorDeps(projectRoot),
      promptAgent: fakePrompt,
      isTTY: false,
      cannedIntakeAnswers: ['Devs', 'Slow workflow', 'One-command CLI'],
    },
  });

  const required = [
    'intake.md',
    'research.md',
    'intent.md',
    ...ALGORITHM_PASS_ARTIFACTS,
    ...REQUIRED_SYNTHESIS_ARTIFACTS,
    'autonomy-contract.md',
    'run.json',
    'status.md',
  ];

  for (const file of required) {
    const full = path.join(ref.runDir, file);
    if (!fs.existsSync(full)) {
      console.error(`FAIL: missing ${file}`);
      process.exit(1);
    }
  }

  console.log(`OK: fixture plan wrote ${required.length} artifacts under ${ref.runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
