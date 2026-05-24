import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubSecrets } from './secrets.js';

const ARTIFACT_DELIMITER = /^---ARTIFACT:\s*(.+?)---\s*$/gm;

export function parseSynthesisArtifacts(raw: string): Map<string, string> {
  const cleaned = scrubSecrets(raw);
  const artifacts = new Map<string, string>();

  const parts = cleaned.split(ARTIFACT_DELIMITER);
  if (parts.length <= 1) {
    throw new Error('Synthesis response missing ---ARTIFACT: filename--- delimiters');
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

export function writeArtifact(runDir: string, filename: string, content: string): string {
  const path = join(runDir, filename);
  writeFileSync(path, `${scrubSecrets(content).trim()}\n`, 'utf8');
  return path;
}

export const REQUIRED_SYNTHESIS_ARTIFACTS = [
  'summary.md',
  'prd.md',
  'implementation-plan.md',
  'issue-plan.md',
  'build-goal.md',
  'algorithm-pass.md',
] as const;

export function assertSynthesisArtifacts(artifacts: Map<string, string>): void {
  for (const name of REQUIRED_SYNTHESIS_ARTIFACTS) {
    if (!artifacts.has(name) || !artifacts.get(name)?.trim()) {
      throw new Error(`Synthesis missing required artifact: ${name}`);
    }
  }
}
