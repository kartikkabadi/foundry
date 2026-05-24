import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COVERAGE_SLOTS } from '@foundry/planner/plan/coverage-slots.js';
import {
  ALGORITHM_PASS_ARTIFACTS,
  REQUIRED_SYNTHESIS_ARTIFACTS,
} from '@foundry/planner/plan/artifacts.js';
import { resumePlanFromCheckpoint } from '@foundry/planner/plan/orchestrate.js';
import {
  createRun,
  initProject,
  pauseRun,
  writeRunState,
  type RunRef,
} from '@foundry/core/state/run-writer.js';
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

Acceptance criteria for demo.`;
    }
    return `---ARTIFACT: ${name}---\n# ${name}\n\nSynthesis content for ${name}.`;
  }).join('\n\n');
}

function mockDoctorDeps(projectRoot: string): DoctorDeps {
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

function seedMidPlanCheckpoint(ref: RunRef, idea: string): RunRef {
  const intakeMd = `# Intake\n\n**Idea:** ${idea}\n\n## Q1: Who\n\nDevs\n`;
  fs.writeFileSync(path.join(ref.runDir, 'intake.md'), intakeMd, 'utf8');
  fs.writeFileSync(
    path.join(ref.runDir, 'research.md'),
    '# Research\nFixture research from checkpoint.',
    'utf8',
  );

  const updated = writeRunState({
    ...ref,
    run: {
      ...ref.run,
      phase: 'interview',
      status: 'paused',
      artifacts: ['intake.md', 'research.md'],
      next_actions: ['Resume with `foundry resume`'],
    },
  });

  return { ...ref, run: updated };
}

describe('plan checkpoint resume (V2-5)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-plan-resume-'));
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('resumes from interview phase and completes remaining artifacts without duplicating research', async () => {
    const idea = 'CLI that converts markdown PRDs to GitHub issues';
    let ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      phase: 'init',
      status: 'running',
    });
    ref = seedMidPlanCheckpoint(ref, idea);

    const researchBefore = fs.readFileSync(path.join(ref.runDir, 'research.md'), 'utf8');
    let promptCalls = 0;

    const fakePrompt = async (prompt: string) => {
      promptCalls += 1;
      if (prompt.includes('intent interview')) return buildFakeIntent();
      if (prompt.includes('Algorithm Pass agent')) return buildFakeAlgorithmPass();
      if (prompt.includes('synthesis agent')) return buildFakeSynthesis();
      if (prompt.includes('research agent')) {
        throw new Error('research should be skipped on resume');
      }
      return 'ok';
    };

    const resumed = await resumePlanFromCheckpoint({
      projectRoot,
      ref,
      deps: {
        doctorDeps: mockDoctorDeps(projectRoot),
        promptAgent: fakePrompt,
        isTTY: false,
      },
    });

    assert.strictEqual(resumed.run.status, 'awaiting_approval');
    assert.strictEqual(resumed.run.phase, 'awaiting_approval');
    assert.ok(promptCalls >= 3, 'should run interview, algorithm, and synthesis passes');

    const researchAfter = fs.readFileSync(path.join(ref.runDir, 'research.md'), 'utf8');
    assert.strictEqual(researchAfter, researchBefore, 'research.md must not be rewritten');

    for (const file of [
      'intent.md',
      ...ALGORITHM_PASS_ARTIFACTS,
      ...REQUIRED_SYNTHESIS_ARTIFACTS,
      'autonomy-contract.md',
    ]) {
      assert.ok(fs.existsSync(path.join(resumed.runDir, file)), `missing ${file}`);
    }
  });

  it('pauseRun preserves phase for resume re-entry', () => {
    let ref = createRun(projectRoot, '0.1.0', { run_id: 'pause-checkpoint' });
    writeRunState({
      ...ref,
      run: {
        ...ref.run,
        phase: 'algorithm_pass',
        artifacts: ['intake.md', 'research.md', 'intent.md'],
      },
    });

    const paused = pauseRun(projectRoot);
    assert.strictEqual(paused.run.status, 'paused');
    assert.strictEqual(paused.run.phase, 'algorithm_pass');
  });
});
