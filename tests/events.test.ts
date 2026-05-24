import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executePlan } from '../src/plan/orchestrate.ts';
import { initProject } from '../src/state/run-writer.ts';
import type { DoctorDeps } from '../src/doctor/deps.ts';
import type { CursorAdapter } from '../src/adapters/cursor.ts';
import { COVERAGE_SLOTS } from '../src/plan/coverage-slots.ts';
import {
  ALGORITHM_PASS_ARTIFACTS,
  REQUIRED_SYNTHESIS_ARTIFACTS,
} from '../src/plan/artifacts.ts';
import {
  appendEvent,
  assertArtifactPathAllowed,
  getCommsPaths,
  readEvents,
} from '../src/comms/events.ts';
import { parseEventRecord } from '../src/schema/events.ts';
import { readFileSync } from 'node:fs';

const TEST_ROOT = path.join(os.tmpdir(), `foundry-events-${process.pid}`);

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
  const distDir = path.join(projectRoot, 'dist');
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

describe('events.jsonl schema (V2-9)', () => {
  let runDir: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    runDir = path.join(TEST_ROOT, `run-${Date.now()}`);
    fs.mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('appendEvent writes valid JSONL lines', () => {
    appendEvent(runDir, {
      type: 'agent_started',
      phase: 'research',
      summary: 'Starting research pass',
    });
    appendEvent(runDir, {
      type: 'artifact_published',
      phase: 'research',
      summary: 'Wrote research.md',
      artifact: 'research.md',
    });

    const events = readEvents(runDir);
    assert.strictEqual(events.length, 2);
    for (const event of events) {
      parseEventRecord(event);
    }
    assert.strictEqual(events[0]?.type, 'agent_started');
    assert.strictEqual(events[1]?.artifact, 'research.md');
  });

  it('assertArtifactPathAllowed rejects raw transcript paths', () => {
    assert.throws(
      () => assertArtifactPathAllowed('transcripts/raw-agent.log'),
      /transcript/i,
    );
    assert.throws(
      () => assertArtifactPathAllowed('comms/transcripts/session.json'),
      /transcript/i,
    );
    assert.doesNotThrow(() => assertArtifactPathAllowed('comms/threads/plan.md'));
    assert.doesNotThrow(() => assertArtifactPathAllowed('research.md'));
  });
});

describe('plan writes events.jsonl + comms threads (V2-9)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = path.join(TEST_ROOT, `project-${Date.now()}`);
    fs.mkdirSync(projectRoot, { recursive: true });
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('executePlan appends typed events and thread summaries', async () => {
    let call = 0;
    const ref = await executePlan({
      idea: 'Fixture planning idea',
      projectRoot,
      deps: {
        doctorDeps: mockDoctorDeps(projectRoot),
        isTTY: false,
        cannedIntakeAnswers: ['quick', 'cli', 'solo'],
        promptAgent: async () => {
          call += 1;
          if (call === 1) return '# Research\n\nFixture research.';
          if (call === 2) return buildFakeIntent();
          if (call === 3) return buildFakeAlgorithmPass();
          return buildFakeSynthesis();
        },
      },
    });

    const { eventsPath, threadsDir } = getCommsPaths(ref.runDir);
    assert.ok(fs.existsSync(eventsPath), 'events.jsonl should exist');
    assert.ok(fs.existsSync(path.join(threadsDir, 'plan.md')), 'plan thread should exist');

    const events = readEvents(ref.runDir);
    assert.ok(events.length >= 4, 'expected events for major plan phases');
    assert.ok(events.some((e) => e.type === 'artifact_published'));
    assert.ok(events.some((e) => e.type === 'agent_finished'));

    for (const event of events) {
      parseEventRecord(event);
    }

    const statusMd = readFileSync(ref.statusMdPath, 'utf8');
    assert.match(statusMd, /Latest event:/);

    const artifactNames = fs.readdirSync(ref.runDir);
    assert.ok(!artifactNames.some((name) => name.includes('transcript')));
  });
});
