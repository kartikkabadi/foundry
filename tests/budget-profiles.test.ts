import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentPassBudgetFromProfile,
  BUDGET_PROFILES,
  DEFAULT_BUDGET,
  resolveBudgetProfile,
} from '../src/config/budget-profiles.ts';
import { COVERAGE_SLOTS } from '../src/plan/coverage-slots.ts';
import {
  ALGORITHM_PASS_ARTIFACTS,
  REQUIRED_SYNTHESIS_ARTIFACTS,
} from '../src/plan/artifacts.ts';
import { executePlan, AgentPassBudgetExhaustedError } from '../src/plan/orchestrate.ts';
import { initProject } from '../src/state/run-writer.ts';
import type { DoctorDeps } from '../src/doctor/deps.ts';
import type { CursorAdapter } from '../src/adapters/cursor.ts';

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

Acceptance criteria for demo.`;
    }
    return `---ARTIFACT: ${name}---\n# ${name}\n\nSynthesis content for ${name}.`;
  }).join('\n\n');
}

function mockDoctorDeps(projectRoot: string, repoRoot: string): DoctorDeps {
  const distDir = path.join(repoRoot, 'dist');
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
    foundryRoot: repoRoot,
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

function fullPlanPrompt() {
  return async (prompt: string) => {
    if (prompt.includes('research agent')) return '# Research\nFixture.';
    if (prompt.includes('intent interview')) return buildFakeIntent();
    if (prompt.includes('Algorithm Pass agent')) return buildFakeAlgorithmPass();
    if (prompt.includes('synthesis agent')) return buildFakeSynthesis();
    return 'ok';
  };
}

describe('budget profiles (V2-6)', () => {
  it('quick profile has lower agent-pass limit than marathon', () => {
    assert.ok(BUDGET_PROFILES.quick.agent_pass_limit < BUDGET_PROFILES.marathon.agent_pass_limit);
    assert.ok(BUDGET_PROFILES.quick.max_active < BUDGET_PROFILES.marathon.max_active);
  });

  it('default budget matches DECISIONS deep profile', () => {
    assert.strictEqual(DEFAULT_BUDGET, 'deep');
    const profile = resolveBudgetProfile(DEFAULT_BUDGET);
    assert.strictEqual(profile.agent_pass_limit, 80);
    assert.strictEqual(profile.max_active, 12);
  });

  it('agentPassBudgetFromProfile maps limits into run.json shape', () => {
    const quick = agentPassBudgetFromProfile(BUDGET_PROFILES.quick);
    assert.deepStrictEqual(quick, { max_active: 5, used: 0, limit: 12 });
  });
});

describe('budget enforcement in orchestrate (V2-6)', () => {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-budget-'));
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('agent pass budget exhaustion pauses plan at checkpoint', async () => {
    const { createRun, writeRunState } = await import('../src/state/run-writer.ts');
    const { resumePlanFromCheckpoint } = await import('../src/plan/orchestrate.ts');

    let ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      budget: 'quick',
      phase: 'interview',
      status: 'paused',
      agent_pass_budget: { max_active: 5, used: 12, limit: 12 },
      artifacts: ['intake.md', 'research.md'],
    });

    const idea = 'budget exhaustion test';
    fs.writeFileSync(
      path.join(ref.runDir, 'intake.md'),
      `# Intake\n\n**Idea:** ${idea}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(ref.runDir, 'research.md'), '# Research\nFixture.', 'utf8');

    await assert.rejects(
      () =>
        resumePlanFromCheckpoint({
          projectRoot,
          ref,
          deps: {
            doctorDeps: mockDoctorDeps(projectRoot, repoRoot),
            promptAgent: async () => 'should not run',
            isTTY: false,
          },
        }),
      AgentPassBudgetExhaustedError,
    );

    const runJson = JSON.parse(
      fs.readFileSync(path.join(ref.runDir, 'run.json'), 'utf8'),
    ) as { status: string };
    assert.strictEqual(runJson.status, 'paused');
  });

  it('quick budget limit is lower than marathon budget limit in run.json', async () => {
    const quickRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-quick-limit-'));
    const marathonRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-marathon-limit-'));
    initProject(quickRoot);
    initProject(marathonRoot);

    try {
      const quickRef = await executePlan({
        idea: 'quick limit',
        projectRoot: quickRoot,
        budget: 'quick',
        deps: {
          doctorDeps: mockDoctorDeps(quickRoot, repoRoot),
          promptAgent: fullPlanPrompt(),
          isTTY: false,
          cannedIntakeAnswers: ['Users', 'Problem', 'Success'],
        },
      });

      const marathonRef = await executePlan({
        idea: 'marathon limit',
        projectRoot: marathonRoot,
        budget: 'marathon',
        deps: {
          doctorDeps: mockDoctorDeps(marathonRoot, repoRoot),
          promptAgent: fullPlanPrompt(),
          isTTY: false,
          cannedIntakeAnswers: ['Users', 'Problem', 'Success'],
        },
      });

      assert.ok(
        quickRef.run.agent_pass_budget.limit < marathonRef.run.agent_pass_budget.limit,
      );
    } finally {
      fs.rmSync(quickRoot, { recursive: true, force: true });
      fs.rmSync(marathonRoot, { recursive: true, force: true });
    }
  });

  it('executePlan records budget profile in run.json', async () => {
    const ref = await executePlan({
      idea: 'record budget',
      projectRoot,
      budget: 'quick',
      deps: {
        doctorDeps: mockDoctorDeps(projectRoot, repoRoot),
        promptAgent: fullPlanPrompt(),
        isTTY: false,
        cannedIntakeAnswers: ['Users', 'Problem', 'Success'],
      },
    });

    assert.strictEqual(ref.run.budget, 'quick');
    assert.strictEqual(ref.run.agent_pass_budget.limit, 12);
  });
});
