import {
  CommsContractError,
  assertGovernedHandoff,
  validateTeamComms,
} from '@foundry/core/team/comms.js';
import { loadTeamSpecFromProject, TeamSpecValidationError } from '@foundry/core/team/spec.js';
import { hasBlockingConflicts, listOpenConflicts } from '@foundry/core/conflicts/conflict.js';
import { BuildPreflightError } from './errors.js';

export { BuildPreflightError };

export interface TeamCommsPreflightOptions {
  /** When true, governed roles must have published handoff.md (end-of-build gate). */
  requireHandoffs?: boolean;
}

function wrapPreflightError(error: unknown): never {
  if (error instanceof CommsContractError || error instanceof TeamSpecValidationError) {
    throw new BuildPreflightError(error.message);
  }
  throw error;
}

/** Validate team comms structure (and optional handoffs) before or during build. */
export function runTeamCommsPreflight(
  projectRoot: string,
  runDir: string,
  options: TeamCommsPreflightOptions = {},
): void {
  try {
    const spec = loadTeamSpecFromProject(projectRoot);
    if (!spec) {
      return;
    }

    validateTeamComms(spec);

    if (options.requireHandoffs) {
      for (const role of spec.roles) {
        if (role.must_publish) {
          assertGovernedHandoff(spec, runDir, role.id);
        }
      }
    }
  } catch (error) {
    wrapPreflightError(error);
  }
}

/** Block build when open conflict artifacts remain in the run folder. */
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
