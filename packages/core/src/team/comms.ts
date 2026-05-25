import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent } from '../comms/events.js';
import type { TeamSpec } from '../schema/team-spec.js';
import { detectReportsToCycle } from './spec.js';

export class CommsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommsContractError';
  }
}

const HANDOFF_TEMPLATE = `# Handoff

## Summary
Completed assigned work for this slice.

## Next
Awaiting orchestrator review.

`;

export function validateTeamComms(spec: TeamSpec): void {
  const cycle = detectReportsToCycle(spec);
  if (cycle) {
    throw new CommsContractError(
      `reports_to cycle detected: ${cycle.join(' → ')}`,
    );
  }
}

export function governedRolesMissingHandoff(
  spec: TeamSpec,
  runDir: string,
  roleId: string,
): string | null {
  const role = spec.roles.find((r) => r.id === roleId);
  if (!role?.must_publish) {
    return null;
  }

  const handoffPath = join(runDir, role.handoff_artifact);
  if (!existsSync(handoffPath)) {
    return role.handoff_artifact;
  }

  const content = readFileSync(handoffPath, 'utf8').trim();
  if (!content) {
    return role.handoff_artifact;
  }

  return null;
}

export function assertGovernedHandoff(
  spec: TeamSpec,
  runDir: string,
  roleId: string,
): void {
  const missing = governedRolesMissingHandoff(spec, runDir, roleId);
  if (missing) {
    throw new CommsContractError(
      `Missing required handoff for role "${roleId}": ${missing}`,
    );
  }
}

export function writeHandoffTemplate(runDir: string, artifactName: string): string {
  const path = join(runDir, artifactName);
  if (!existsSync(path)) {
    writeFileSync(path, HANDOFF_TEMPLATE, 'utf8');
  }
  return path;
}

export function logHandoffPublished(
  runDir: string,
  roleId: string,
  artifact: string,
): void {
  appendEvent(runDir, {
    type: 'handoff_published',
    phase: 'build',
    summary: `Handoff published for role ${roleId}`,
    artifact,
    thread: 'build.md',
  });
}
