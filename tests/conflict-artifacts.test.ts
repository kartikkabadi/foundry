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

  it('resolveConflict is idempotent and sets resolved timestamp once', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-conflict-resolve-'));
    writeConflict(runDir, {
      id: 'c3',
      prd_section: '§1',
      summary: 'Duplicate resolve must not corrupt status',
      status: 'open',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    resolveConflict(runDir, 'c3');
    const first = fs.readFileSync(path.join(runDir, 'conflicts', 'c3.md'), 'utf8');
    assert.match(first, /\*\*Status:\*\* resolved/);
    assert.match(first, /\*\*Resolved:\*\*/);
    assert.doesNotMatch(first, /\*\*Status:\*\* open/);

    resolveConflict(runDir, 'c3');
    const second = fs.readFileSync(path.join(runDir, 'conflicts', 'c3.md'), 'utf8');
    assert.strictEqual(second, first);
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
