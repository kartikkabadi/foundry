import type { DoctorForTarget } from '@foundry/core/types/doctor.js';

export interface PreflightEnv {
  FOUNDRY_BUILD_MOCK?: string;
}

export interface ResolvedPreflightOptions {
  forTarget: DoctorForTarget;
  deep: boolean;
  strict: boolean;
}

/** Doctor preflight policy: plan always deep-smokes Composer; build deep only for real agent runs. */
export function resolvePreflightOptions(
  forTarget: DoctorForTarget,
  env: PreflightEnv = process.env as PreflightEnv,
): ResolvedPreflightOptions {
  const strict = false;
  if (forTarget === 'plan') {
    return { forTarget: 'plan', deep: true, strict };
  }
  if (forTarget === 'build') {
    const mockBuild = env.FOUNDRY_BUILD_MOCK === '1';
    return { forTarget: 'build', deep: !mockBuild, strict };
  }
  return { forTarget, deep: false, strict };
}
