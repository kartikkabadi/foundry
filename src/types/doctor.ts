/** Frozen doctor JSON contract (H0). Do not change without spec review. */

export const DOCTOR_SCHEMA_VERSION = '1' as const;

export type DoctorCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

/** Required checks for `--for plan` (v1 minimum matrix). */
export type DoctorRequiredCheckId =
  | 'system'
  | 'node-package-manager'
  | 'foundry-install'
  | 'pi-cli'
  | 'cursor-sdk'
  | 'composer-2.5-standard'
  | 'project-foundry-config';

export type DoctorExpandedOptionalCheckId =
  | 'pi-runtime'
  | 'composer-2.5-fast'
  | 'browser-capture'
  | 'cuadriver-computer-use'
  | 'skills-team-packs';

export type DoctorOptionalCheckId =
  | 'git-github'
  | 'git-worktrees'
  | DoctorExpandedOptionalCheckId;

export type DoctorCheckId = DoctorRequiredCheckId | DoctorOptionalCheckId;

export interface DoctorCheck {
  id: DoctorCheckId;
  status: DoctorCheckStatus;
  message: string;
  repair?: string;
}

export type DoctorForTarget = 'plan' | 'setup' | 'all';

export interface DoctorReport {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  for: DoctorForTarget;
  checks: DoctorCheck[];
  exitCode: 0 | 1 | 2;
  generatedAt: string;
}
