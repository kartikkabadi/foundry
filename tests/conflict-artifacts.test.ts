import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasBlockingConflicts,
  listOpenConflicts,
  resolveConflict,
  writeConflict,
} from '@foundry/core/conflicts/conflict.js';

describe('conflict artifacts (#37)', () => {
  it('conflict blocks merge until resolved', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-conflict-'));
    writeConflict(runDir, {
      id: 'c1',
      prd_section: '§3 Goals',
      summary: 'Agents disagree on MVP scope',
      status: 'open',
      created_at: new Date().toISOString(),
    });
    assert.strictEqual(hasBlockingConflicts(runDir), true);
    assert.strictEqual(listOpenConflicts(runDir).length, 1);

    resolveConflict(runDir, 'c1');
    assert.strictEqual(hasBlockingConflicts(runDir), false);
  });

  it('conflict.md includes PRD section link', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-conflict-md-'));
    const filePath = writeConflict(runDir, {
      id: 'c2',
      prd_section: 'prd.md#risks',
      summary: 'Risk appetite mismatch',
      status: 'open',
      created_at: new Date().toISOString(),
    });
    const body = fs.readFileSync(filePath, 'utf8');
    assert.match(body, /prd\.md#risks/);
    assert.match(body, /\*\*Status:\*\* open/);
  });
});
