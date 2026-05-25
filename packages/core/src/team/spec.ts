import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import TOML from 'smol-toml';
import { ZodError } from 'zod';
import { teamSpecSchema, type TeamSpec } from '../schema/team-spec.js';
import { getProjectFoundryDir } from '../state/project-init.js';

export class TeamSpecValidationError extends Error {
  readonly line?: number;
  readonly issues: string[];

  constructor(message: string, issues: string[], line?: number) {
    super(message);
    this.name = 'TeamSpecValidationError';
    this.issues = issues;
    this.line = line;
  }
}

function formatZodIssues(err: ZodError): string[] {
  return err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
}

function parseTomlWithLineContext(source: string): unknown {
  try {
    return TOML.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lineMatch = message.match(/line (\d+)/i);
    const line = lineMatch ? Number(lineMatch[1]) : undefined;
    throw new TeamSpecValidationError(
      `Invalid TOML: ${message}`,
      [message],
      line,
    );
  }
}

export function parseTeamSpecSource(source: string, label = 'team spec'): TeamSpec {
  const raw = parseTomlWithLineContext(source);
  const parsed = teamSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    throw new TeamSpecValidationError(`${label} validation failed`, issues);
  }
  return parsed.data;
}

export function loadTeamSpecFromFile(filePath: string): TeamSpec {
  const source = readFileSync(filePath, 'utf8');
  return parseTeamSpecSource(source, filePath);
}

/** Load embedded `[team]` section from `.foundry/config.toml`, if present. */
export function loadTeamSpecFromProject(projectRoot: string): TeamSpec | null {
  const configPath = join(getProjectFoundryDir(projectRoot), 'config.toml');
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = parseTomlWithLineContext(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const team = raw.team;
  if (!team || typeof team !== 'object') {
    return null;
  }

  const section = team as Record<string, unknown>;
  const parsed = teamSpecSchema.safeParse({
    version: section.version ?? 1,
    name: section.name,
    roles: section.roles ?? [],
  });

  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    throw new TeamSpecValidationError('project config team section invalid', issues);
  }

  return parsed.data;
}

export function teamSpecToConfigSection(spec: TeamSpec): string {
  const lines = [
    '',
    '[team]',
    `name = ${JSON.stringify(spec.name)}`,
    `version = ${spec.version}`,
    '',
  ];

  for (const role of spec.roles) {
    lines.push('[[team.roles]]');
    lines.push(`id = ${JSON.stringify(role.id)}`);
    if (role.reports_to) {
      lines.push(`reports_to = ${JSON.stringify(role.reports_to)}`);
    }
    lines.push(`must_publish = ${role.must_publish}`);
    lines.push(`handoff_artifact = ${JSON.stringify(role.handoff_artifact)}`);
    if (role.capabilities.length > 0) {
      lines.push(`capabilities = ${JSON.stringify(role.capabilities)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function detectReportsToCycle(spec: TeamSpec): string[] | null {
  const byId = new Map(spec.roles.map((r) => [r.id, r]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(roleId: string, stack: string[]): string[] | null {
    if (visited.has(roleId)) {
      return null;
    }
    if (visiting.has(roleId)) {
      const cycleStart = stack.indexOf(roleId);
      return [...stack.slice(cycleStart), roleId];
    }

    const role = byId.get(roleId);
    if (!role?.reports_to) {
      visited.add(roleId);
      return null;
    }

    if (!byId.has(role.reports_to)) {
      return null;
    }

    visiting.add(roleId);
    const cycle = visit(role.reports_to, [...stack, roleId]);
    visiting.delete(roleId);
    if (cycle) {
      return cycle;
    }
    visited.add(roleId);
    return null;
  }

  for (const role of spec.roles) {
    const cycle = visit(role.id, []);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}
