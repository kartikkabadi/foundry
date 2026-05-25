import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEvents } from '@foundry/core/comms/events.js';
import {
  assertGovernedHandoff,
  CommsContractError,
  logHandoffPublished,
  validateTeamComms,
  writeHandoffTemplate,
} from '@foundry/core/team/comms.js';
import { loadTeamSpecFromFile } from '@foundry/core/team/spec.js';

const root = path.join(import.meta.dirname, '..');

describe('comms contracts (#34)', () => {
  it('missing handoff fails for governed roles', () => {
    const spec = loadTeamSpecFromFile(path.join(root, 'fixtures/team-pack-valid.toml'));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-comms-'));
    assert.throws(
      () => assertGovernedHandoff(spec, runDir, 'researcher'),
      (err: unknown) => err instanceof CommsContractError,
    );
  });

  it('handoff template satisfies must_publish', () => {
    const spec = loadTeamSpecFromFile(path.join(root, 'fixtures/team-pack-valid.toml'));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-comms-ok-'));
    writeHandoffTemplate(runDir, 'handoff.md');
    assert.doesNotThrow(() => assertGovernedHandoff(spec, runDir, 'researcher'));
  });

  it('reports_to cycle detection fails validation', () => {
    const spec = loadTeamSpecFromFile(path.join(root, 'fixtures/team-pack-valid.toml'));
    spec.roles.push({
      id: 'cycle-a',
      reports_to: 'cycle-b',
      must_publish: false,
      handoff_artifact: 'handoff.md',
      capabilities: [],
    });
    spec.roles.push({
      id: 'cycle-b',
      reports_to: 'cycle-a',
      must_publish: false,
      handoff_artifact: 'handoff.md',
      capabilities: [],
    });
    assert.throws(() => validateTeamComms(spec), CommsContractError);
  });

  it('events log handoff publication', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-comms-ev-'));
    logHandoffPublished(runDir, 'researcher', 'handoff.md');
    const events = readEvents(runDir);
    assert.ok(events.some((e) => e.type === 'handoff_published'));
  });
});
