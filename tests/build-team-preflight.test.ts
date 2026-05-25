import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '@foundry/core/state/run-writer.js';
import { writeHandoffTemplate } from '@foundry/core/team/comms.js';
import {
  BuildPreflightError,
  runTeamCommsPreflight,
  assertNoBlockingConflicts,
} from '@foundry/planner/build/team-preflight.js';
import { writeConflict } from '@foundry/core/conflicts/conflict.js';

const root = path.join(import.meta.dirname, '..');

describe('build team + conflict preflight (#34, #37)', () => {
  let projectRoot: string;
  let runDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-team-'));
    initProject(projectRoot, {
      teamPackPath: path.join(root, 'fixtures/team-pack-valid.toml'),
    });
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-run-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('fails build preflight when governed handoff is missing', () => {
    assert.throws(
      () => runTeamCommsPreflight(projectRoot, runDir),
      (err: unknown) => err instanceof BuildPreflightError && /handoff/i.test(err.message),
    );
  });

  it('passes when handoff template exists for governed role', () => {
    writeHandoffTemplate(runDir, 'handoff.md');
    assert.doesNotThrow(() => runTeamCommsPreflight(projectRoot, runDir));
  });

  it('blocks build when open conflicts exist', () => {
    writeConflict(runDir, {
      id: 'c-open',
      prd_section: 'prd.md#goals',
      summary: 'Unresolved scope conflict',
      status: 'open',
      created_at: new Date().toISOString(),
    });
    assert.throws(
      () => assertNoBlockingConflicts(runDir),
      (err: unknown) => err instanceof BuildPreflightError && /open conflict/i.test(err.message),
    );
  });
});
