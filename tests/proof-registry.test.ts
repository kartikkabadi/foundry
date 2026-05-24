import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ProofValidationError,
  defaultProofEvidence,
  readProofJson,
  toProofRecord,
  validateProofPayload,
  writeProofJson,
} from '@foundry/planner/build/proof-registry.js';
import type { ProofType } from '@foundry/core/types/build.js';

describe('proof registry by issue type (V3-5)', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-proof-'));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  for (const type of ['code', 'ui', 'docs', 'config', 'research'] as ProofType[]) {
    it(`validates and writes proof for type ${type}`, () => {
      const evidence = defaultProofEvidence(type);
      const payload = {
        issue: 1,
        type,
        summary: `Proof for ${type}`,
        evidence,
      };

      validateProofPayload(type, payload);
      const proofPath = writeProofJson(runDir, payload);
      assert.ok(fs.existsSync(proofPath));

      const read = readProofJson(proofPath);
      assert.strictEqual(read.type, type);

      const record = toProofRecord(proofPath, read);
      assert.strictEqual(record.valid, true);
    });
  }

  it('missing proof evidence blocks completion', () => {
    assert.throws(
      () =>
        validateProofPayload('code', {
          issue: 1,
          type: 'code',
          summary: 'incomplete',
          evidence: {},
        }),
      ProofValidationError,
    );
  });
});
