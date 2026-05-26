import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEvents } from '@foundry/core/comms/events.js';
import { initProject } from '@foundry/core/state/run-writer.js';
import { publishTeamHandoffs } from '@foundry/planner/build/publish-handoffs.js';

describe('build handoff publication (#34)', () => {
  it('writes handoff.md and handoff_published events for governed roles', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-handoff-'));
    try {
      initProject(projectRoot, {
        teamPackPath: path.join(import.meta.dirname, '../fixtures/team-pack-valid.toml'),
      });

      const runDir = path.join(projectRoot, '.foundry', 'runs', 'handoff-run');
      fs.mkdirSync(runDir, { recursive: true });

      publishTeamHandoffs(projectRoot, runDir);

      assert.ok(fs.existsSync(path.join(runDir, 'handoff.md')));
      const events = readEvents(runDir);
      assert.ok(events.some((e) => e.type === 'handoff_published'));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
