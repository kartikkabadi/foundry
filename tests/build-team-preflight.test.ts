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

  it('structure preflight passes without handoffs at build start', () => {
    assert.doesNotThrow(() =>
      runTeamCommsPreflight(projectRoot, runDir, { requireHandoffs: false }),
    );
  });

  it('handoff gate fails when governed handoff is missing', () => {
    assert.throws(
      () => runTeamCommsPreflight(projectRoot, runDir, { requireHandoffs: true }),
      (err: unknown) => err instanceof BuildPreflightError && /handoff/i.test(err.message),
    );
  });

  it('handoff gate passes when handoff template exists', () => {
    writeHandoffTemplate(runDir, 'handoff.md');
    assert.doesNotThrow(() =>
      runTeamCommsPreflight(projectRoot, runDir, { requireHandoffs: true }),
    );
  });

  it('wraps invalid [team] config as BuildPreflightError', () => {
    const configPath = path.join(projectRoot, '.foundry', 'config.toml');
    fs.writeFileSync(configPath, 'version = 1\nteam = "not-a-table"\n', 'utf8');
    assert.throws(
      () => runTeamCommsPreflight(projectRoot, runDir),
      (err: unknown) => err instanceof BuildPreflightError && /team/i.test(err.message),
    );
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
