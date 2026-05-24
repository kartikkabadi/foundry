import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubSecrets } from '@foundry/core/config/secrets.js';

const ARTIFACT_DELIMITER = /^---ARTIFACT:\s*(.+?)---\s*$/gm;

export function parseDelimitedArtifacts(raw: string): Map<string, string> {
  const cleaned = scrubSecrets(raw);
  const artifacts = new Map<string, string>();

  const parts = cleaned.split(ARTIFACT_DELIMITER);
  if (parts.length <= 1) {
    throw new Error('Response missing ---ARTIFACT: filename--- delimiters');
  }

  let index = 1;
  while (index < parts.length - 1) {
    const filename = parts[index]?.trim();
    const content = parts[index + 1]?.trim() ?? '';
    if (filename) {
      artifacts.set(filename, content);
    }
    index += 2;
  }

  return artifacts;
}

/** @deprecated Use parseDelimitedArtifacts */
export const parseSynthesisArtifacts = parseDelimitedArtifacts;

export function writeArtifact(runDir: string, filename: string, content: string): string {
  const path = join(runDir, filename);
  writeFileSync(path, `${scrubSecrets(content).trim()}\n`, 'utf8');
  return path;
}

export const ALGORITHM_PASS_ARTIFACTS = [
  'requirements.md',
  'deletion-pass.md',
  'minimum-system.md',
  'simplification-pass.md',
  'acceleration-pass.md',
  'automation-pass.md',
  'assumptions.md',
  'decisions.md',
  'risks.md',
] as const;

export const REQUIRED_SYNTHESIS_ARTIFACTS = [
  'summary.md',
  'prd.md',
  'implementation-plan.md',
  'issue-plan.md',
  'build-goal.md',
] as const;

export const ALL_PLAN_ARTIFACTS = [
  'intake.md',
  'research.md',
  'intent.md',
  ...ALGORITHM_PASS_ARTIFACTS,
  ...REQUIRED_SYNTHESIS_ARTIFACTS,
  'autonomy-contract.md',
] as const;

export function assertRequiredArtifacts(
  artifacts: Map<string, string>,
  required: readonly string[],
  label: string,
): void {
  for (const name of required) {
    if (!artifacts.has(name) || !artifacts.get(name)?.trim()) {
      throw new Error(`${label} missing required artifact: ${name}`);
    }
  }
}

export function assertAlgorithmPassArtifacts(artifacts: Map<string, string>): void {
  assertRequiredArtifacts(artifacts, ALGORITHM_PASS_ARTIFACTS, 'Algorithm Pass');
}

export function assertSynthesisArtifacts(artifacts: Map<string, string>): void {
  assertRequiredArtifacts(artifacts, REQUIRED_SYNTHESIS_ARTIFACTS, 'Synthesis');
}
