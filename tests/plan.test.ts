import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COVERAGE_SLOTS } from '@foundry/planner/plan/coverage-slots.js';
import {
  ALGORITHM_PASS_ARTIFACTS,
  parseDelimitedArtifacts,
  REQUIRED_SYNTHESIS_ARTIFACTS,
} from '@foundry/planner/plan/artifacts.js';
import { validateIntentCoverage } from '@foundry/planner/plan/coverage-slots.js';
import { executePlan } from '@foundry/planner/plan/orchestrate.js';
import { initProject } from '@foundry/core/state/run-writer.js';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import type { CursorAdapter } from '@foundry/adapters/cursor.js';

function buildFakeIntent(): string {
  return COVERAGE_SLOTS.map((slot, i) => `## Slot ${i + 1}: ${slot}\n\nIntent for ${slot}.`).join(
    '\n\n',
  );
}

function buildFakeAlgorithmPass(): string {
  return ALGORITHM_PASS_ARTIFACTS.map(
    (name) => `---ARTIFACT: ${name}---\n# ${name}\n\nAlgorithm pass content for ${name}.`,
  ).join('\n\n');
}

function buildFakeSynthesis(): string {
  return REQUIRED_SYNTHESIS_ARTIFACTS.map((name) => {
    if (name === 'issue-plan.md') {
      return `---ARTIFACT: issue-plan.md---
## Issue 1: Demo issue

Acceptance criteria for demo.

## Issue 2: Second demo issue

More AC.`;
    }
    return `---ARTIFACT: ${name}---\n# ${name}\n\nSynthesis content for ${name}.`;
  }).join('\n\n');
}

function mockDoctorDeps(projectRoot: string): DoctorDeps {
  const distDir = path.join(projectRoot, 'packages', 'cli', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'cli.js'), '#!/usr/bin/env node\n', 'utf8');
  fs.mkdirSync(path.join(projectRoot, '.foundry'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');

  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'mock' };
    },
  };

  return {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd: projectRoot,
    env: { CURSOR_API_KEY: 'test-key' },
    foundryRoot: projectRoot,
    piAuthPath: path.join(projectRoot, 'missing-auth.json'),
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

describe('plan artifacts parsing', () => {
  it('parses synthesis delimiters', () => {
    const raw = buildFakeSynthesis();
    const parsed = parseDelimitedArtifacts(raw);
    assert.strictEqual(parsed.size, REQUIRED_SYNTHESIS_ARTIFACTS.length);
    for (const name of REQUIRED_SYNTHESIS_ARTIFACTS) {
      assert.ok(parsed.has(name));
    }
  });

  it('parses algorithm pass delimiters', () => {
    const raw = buildFakeAlgorithmPass();
    const parsed = parseDelimitedArtifacts(raw);
    assert.strictEqual(parsed.size, ALGORITHM_PASS_ARTIFACTS.length);
    for (const name of ALGORITHM_PASS_ARTIFACTS) {
      assert.ok(parsed.has(name));
    }
  });

  it('validateIntentCoverage requires all 10 slots', () => {
    assert.doesNotThrow(() => validateIntentCoverage(buildFakeIntent()));
    assert.throws(() => validateIntentCoverage('## Slot 1: only one'));
  });
});

describe('plan orchestration (fake planner, no network)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-plan-'));
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates all V1 planning artifacts and stops at awaiting_approval', async () => {
    const fakePrompt = async (prompt: string) => {
      if (prompt.includes('research agent')) return '# Research\nFixture research.';
      if (prompt.includes('intent interview')) return buildFakeIntent();
      if (prompt.includes('Algorithm Pass agent')) return buildFakeAlgorithmPass();
      if (prompt.includes('synthesis agent')) return buildFakeSynthesis();
      return 'ok';
    };

    const ref = await executePlan({
      idea: 'CLI that converts markdown PRDs to GitHub issues',
      projectRoot,
      deps: {
        doctorDeps: mockDoctorDeps(projectRoot),
        promptAgent: fakePrompt,
        isTTY: false,
        cannedIntakeAnswers: ['Devs', 'Slow PRD-to-issue workflow', 'One-command CLI'],
      },
    });

    assert.strictEqual(ref.run.status, 'awaiting_approval');
    assert.strictEqual(ref.run.phase, 'awaiting_approval');

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
      assert.ok(fs.existsSync(path.join(ref.runDir, file)), `missing ${file}`);
    }

    const status = fs.readFileSync(path.join(ref.runDir, 'status.md'), 'utf8');
    assert.ok(status.includes('awaiting_approval'));

    for (const file of required) {
      const content = fs.readFileSync(path.join(ref.runDir, file), 'utf8');
      assert.ok(!content.includes('test-key'), `${file} leaked API key`);
    }
  });
});
