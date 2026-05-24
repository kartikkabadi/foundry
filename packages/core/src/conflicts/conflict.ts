import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ConflictRecord {
  id: string;
  prd_section: string;
  summary: string;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at?: string;
}

export function conflictsDir(runDir: string): string {
  return join(runDir, 'conflicts');
}

export function conflictPath(runDir: string, conflictId: string): string {
  return join(conflictsDir(runDir), `${conflictId}.md`);
}

export function writeConflict(runDir: string, record: ConflictRecord): string {
  const dir = conflictsDir(runDir);
  mkdirSync(dir, { recursive: true });
  const body = [
    `# Conflict ${record.id}`,
    '',
    `**PRD section:** ${record.prd_section}`,
    `**Status:** ${record.status}`,
    `**Created:** ${record.created_at}`,
    record.resolved_at ? `**Resolved:** ${record.resolved_at}` : '',
    '',
    '## Summary',
    record.summary,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const path = conflictPath(runDir, record.id);
  writeFileSync(path, body, 'utf8');
  return path;
}

export function listOpenConflicts(runDir: string): ConflictRecord[] {
  const dir = conflictsDir(runDir);
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const open: ConflictRecord[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    if (content.includes('**Status:** open')) {
      const id = file.replace(/\.md$/, '');
      const sectionMatch = content.match(/\*\*PRD section:\*\* (.+)/);
      const summaryMatch = content.match(/## Summary\n([\s\S]+?)(?:\n#|$)/);
      open.push({
        id,
        prd_section: sectionMatch?.[1]?.trim() ?? 'unknown',
        summary: summaryMatch?.[1]?.trim() ?? '',
        status: 'open',
        created_at: '',
      });
    }
  }

  return open;
}

export function hasBlockingConflicts(runDir: string): boolean {
  return listOpenConflicts(runDir).length > 0;
}

export function resolveConflict(runDir: string, conflictId: string): void {
  const path = conflictPath(runDir, conflictId);
  if (!existsSync(path)) {
    throw new Error(`Conflict not found: ${conflictId}`);
  }
  const content = readFileSync(path, 'utf8').replace('**Status:** open', '**Status:** resolved');
  const resolved = content.includes('**Resolved:**')
    ? content
    : content.replace(
        '**Created:**',
        `**Resolved:** ${new Date().toISOString()}\n**Created:**`,
      );
  writeFileSync(path, resolved.replace('**Status:** open', '**Status:** resolved'), 'utf8');
}
