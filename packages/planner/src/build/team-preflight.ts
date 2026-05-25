import {
  CommsContractError,
  assertGovernedHandoff,
  validateTeamComms,
} from '@foundry/core/team/comms.js';
import { loadTeamSpecFromProject } from '@foundry/core/team/spec.js';
import { hasBlockingConflicts, listOpenConflicts } from '@foundry/core/conflicts/conflict.js';
import { BuildPreflightError } from './errors.js';

export { BuildPreflightError };

export function runTeamCommsPreflight(projectRoot: string, runDir: string): void {
  const spec = loadTeamSpecFromProject(projectRoot);
  if (!spec) {
    return;
  }

  try {
    validateTeamComms(spec);
    for (const role of spec.roles) {
      if (role.must_publish) {
        assertGovernedHandoff(spec, runDir, role.id);
      }
    }
  } catch (error) {
    if (error instanceof CommsContractError) {
      throw new BuildPreflightError(error.message);
    }
    throw error;
  }
}

export function assertNoBlockingConflicts(runDir: string): void {
  if (!hasBlockingConflicts(runDir)) {
    return;
  }

  const open = listOpenConflicts(runDir);
  const ids = open.map((c) => c.id).join(', ');
  throw new BuildPreflightError(
    `Build blocked: ${open.length} open conflict(s) (${ids}). Resolve under .foundry/runs/.../conflicts/ before continuing.`,
  );
}
