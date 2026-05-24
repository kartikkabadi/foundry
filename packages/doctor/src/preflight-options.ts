import type { DoctorForTarget } from '@foundry/core/types/doctor.js';
import type { RunDoctorOptions } from './run.js';

export interface PreflightEnv {
  FOUNDRY_BUILD_MOCK?: string;
}

export interface ResolvedPreflightOptions {
  forTarget: DoctorForTarget;
  deep: boolean;
}

export function isMockBuild(env: PreflightEnv = process.env as PreflightEnv): boolean {
  return env.FOUNDRY_BUILD_MOCK === '1';
}

/** Doctor preflight policy: plan always deep-smokes Composer; build deep only for real agent runs. */
export function resolvePreflightOptions(
  forTarget: DoctorForTarget,
  env: PreflightEnv = process.env as PreflightEnv,
): ResolvedPreflightOptions {
  if (forTarget === 'plan') {
    return { forTarget: 'plan', deep: true };
  }
  if (forTarget === 'build') {
    return { forTarget: 'build', deep: !isMockBuild(env) };
  }
  return { forTarget, deep: false };
}

/** Orchestrator preflight: mode policy + non-strict doctor (hard-fail handled by caller). */
export function resolveModePreflightChecks(
  forTarget: DoctorForTarget,
  env: PreflightEnv = process.env as PreflightEnv,
): RunDoctorOptions {
  return { ...resolvePreflightOptions(forTarget, env), strict: false };
}

/** CLI/orchestration: explicit --deep wins; otherwise mode policy (matches executeBuild / executePlan). */
export function mergeDoctorCheckOptions(
  parsed: Pick<RunDoctorOptions, 'forTarget' | 'deep' | 'strict'> & {
    composerFastExplicit?: boolean;
  },
  env: PreflightEnv = process.env as PreflightEnv,
): RunDoctorOptions {
  const policy = resolvePreflightOptions(parsed.forTarget, env);
  return {
    forTarget: parsed.forTarget,
    deep: parsed.deep || policy.deep,
    strict: parsed.strict,
    composerFastExplicit: parsed.composerFastExplicit,
  };
}
