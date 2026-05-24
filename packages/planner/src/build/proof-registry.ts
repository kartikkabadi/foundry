import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProofRecord, ProofType } from '@foundry/core/types/build.js';

export class ProofValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofValidationError';
  }
}

export interface ProofPayload {
  issue: number;
  type: ProofType;
  summary: string;
  evidence?: Record<string, unknown>;
}

const REQUIRED_EVIDENCE: Record<ProofType, readonly string[]> = {
  code: ['tests_passed'],
  ui: ['screenshot'],
  docs: ['links_valid'],
  config: ['smoke_test'],
  research: ['citations'],
};

export function validateProofPayload(type: ProofType, payload: ProofPayload): void {
  const required = REQUIRED_EVIDENCE[type];
  const evidence = payload.evidence ?? {};

  for (const key of required) {
    if (!(key in evidence)) {
      throw new ProofValidationError(`Proof type "${type}" missing evidence key: ${key}`);
    }
  }
}

export function writeProofJson(runDir: string, payload: ProofPayload): string {
  validateProofPayload(payload.type, payload);
  const proofsDir = join(runDir, 'proofs');
  mkdirSync(proofsDir, { recursive: true });

  const proofPath = join(proofsDir, `issue-${String(payload.issue).padStart(2, '0')}.json`);
  writeFileSync(proofPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return proofPath;
}

export function readProofJson(proofPath: string): ProofPayload {
  if (!existsSync(proofPath)) {
    throw new ProofValidationError(`Proof file not found: ${proofPath}`);
  }
  return JSON.parse(readFileSync(proofPath, 'utf8')) as ProofPayload;
}

export function toProofRecord(proofPath: string, payload: ProofPayload): ProofRecord {
  try {
    validateProofPayload(payload.type, payload);
    return {
      issue: payload.issue,
      type: payload.type,
      path: proofPath,
      valid: true,
    };
  } catch {
    return {
      issue: payload.issue,
      type: payload.type,
      path: proofPath,
      valid: false,
    };
  }
}

export function defaultProofEvidence(type: ProofType): Record<string, unknown> {
  switch (type) {
    case 'code':
      return { tests_passed: true };
    case 'ui':
      return { screenshot: 'fixture.png' };
    case 'docs':
      return { links_valid: true };
    case 'config':
      return { smoke_test: 'passed' };
    case 'research':
      return { citations: ['https://example.com/source'] };
  }
}
