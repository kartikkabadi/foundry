import type {
  DoctorCheck,
  DoctorCheckId,
  DoctorForTarget,
  DoctorReport,
  DoctorRequiredCheckId,
} from '@foundry/core/types/doctor.js';
import { validateDoctorReport } from '@foundry/core/schema/doctor-report.js';
import { DOCTOR_SCHEMA_VERSION } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from './deps.js';
import {
  checkBrowserCapture,
  checkComposer25Fast,
  checkComposer25Standard,
  checkCuadriverComputerUse,
  checkCursorSdk,
  checkFoundryInstall,
  checkGitGithub,
  checkGitWorktrees,
  checkNodePackageManager,
  checkPiCli,
  checkPiRuntime,
  checkProjectFoundryConfig,
  checkSkillsTeamPacks,
  checkSystem,
} from './checks/index.js';

export interface RunDoctorOptions {
  forTarget: DoctorForTarget;
  deep: boolean;
  strict: boolean;
  composerFastExplicit?: boolean;
}

const REQUIRED_CHECK_IDS: readonly DoctorRequiredCheckId[] = [
  'system',
  'node-package-manager',
  'foundry-install',
  'pi-cli',
  'cursor-sdk',
  'composer-2.5-standard',
  'project-foundry-config',
] as const;

const OPTIONAL_CHECK_IDS = [
  'git-github',
  'git-worktrees',
  'pi-runtime',
  'composer-2.5-fast',
  'browser-capture',
  'cuadriver-computer-use',
  'skills-team-packs',
] as const;

/** Checks Foundry can repair via `doctor --fix`; external deps may still fail. */
export const FOUNDRY_OWNED_CHECK_IDS = ['system', 'foundry-install', 'project-foundry-config'] as const;

export function computeFixModeExitCode(checks: DoctorCheck[]): 0 | 1 {
  for (const check of checks) {
    if (
      (FOUNDRY_OWNED_CHECK_IDS as readonly string[]).includes(check.id) &&
      check.status === 'fail'
    ) {
      return 1;
    }
  }
  return 0;
}

export function computeExitCode(checks: DoctorCheck[], strict: boolean): 0 | 1 | 2 {
  for (const check of checks) {
    if (check.status === 'fail') {
      return 1;
    }
  }

  if (strict) {
    for (const check of checks) {
      if (check.status === 'warn') {
        return 1;
      }
    }
  }

  return 0;
}

function isRequiredCheck(id: DoctorCheckId): id is DoctorRequiredCheckId {
  return (REQUIRED_CHECK_IDS as readonly string[]).includes(id);
}

export async function runDoctorChecks(
  deps: DoctorDeps,
  options: RunDoctorOptions,
): Promise<DoctorReport> {
  const { forTarget, deep, strict, composerFastExplicit = false } = options;
  const includeOptional = forTarget === 'all' || forTarget === 'setup' || forTarget === 'build';
  const includeExpanded = forTarget === 'all';
  const checks: DoctorCheck[] = [];

  try {
    checks.push(checkSystem(deps));
    checks.push(checkNodePackageManager(deps));
    checks.push(checkFoundryInstall(deps));
    checks.push(checkPiCli(deps));
    checks.push(checkCursorSdk(deps));
    checks.push(await checkComposer25Standard(deps, deep));
    checks.push(checkProjectFoundryConfig(deps));

    if (includeOptional) {
      checks.push(checkGitGithub(deps));
      checks.push(checkGitWorktrees(deps));
    }

    if (includeExpanded) {
      checks.push(checkPiRuntime(deps));
      checks.push(
        await checkComposer25Fast(deps, { deep, explicit: composerFastExplicit }),
      );
      checks.push(checkBrowserCapture(deps));
      checks.push(checkCuadriverComputerUse(deps, deep));
      checks.push(checkSkillsTeamPacks(deps));
    }

    const filtered =
      forTarget === 'plan'
        ? checks.filter((c) => isRequiredCheck(c.id))
        : checks;

    const exitCode = computeExitCode(filtered, strict);

    return validateDoctorReport({
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      for: forTarget,
      checks: filtered,
      exitCode,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return validateDoctorReport({
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      for: forTarget,
      checks: [
        {
          id: 'system',
          status: 'fail',
          message: `Doctor internal error: ${message}`,
        },
      ],
      exitCode: 2,
      generatedAt: new Date().toISOString(),
    });
  }
}

export { REQUIRED_CHECK_IDS, OPTIONAL_CHECK_IDS };
