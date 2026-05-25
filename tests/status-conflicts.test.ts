import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRun, formatRunSummary, initProject } from '@foundry/core/state/run-writer.js';
import { writeConflict } from '@foundry/core/conflicts/conflict.js';

describe('status conflicts (#37)', () => {
  it('formatRunSummary includes open conflict count', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-status-conf-'));
    try {
      initProject(projectRoot);
      const ref = createRun(projectRoot, '0.1.0', {
        mode: 'plan',
        status: 'running',
        phase: 'research',
      });

      writeConflict(ref.runDir, {
        id: 'scope-1',
        prd_section: 'prd.md#scope',
        summary: 'MVP disagreement',
        status: 'open',
        created_at: new Date().toISOString(),
      });

      const summary = formatRunSummary(ref);
      assert.match(summary, /Open conflicts: 1/);
      assert.match(summary, /scope-1/);
      assert.match(summary, /Blocked: resolve conflicts/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
