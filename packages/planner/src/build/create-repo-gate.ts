import type { AutonomyProfile } from '@foundry/core/types/build.js';

export interface CreateRepoGateResult {
  allowed: boolean;
  reason: string;
}

export function evaluateCreateRepoGate(
  profile: AutonomyProfile,
  options: { explicitApproval: boolean },
): CreateRepoGateResult {
  if (profile.name === 'safe') {
    return {
      allowed: false,
      reason: 'create-repo blocked in safe autonomy profile',
    };
  }

  if (!options.explicitApproval) {
    return {
      allowed: false,
      reason: 'create-repo requires explicit approval (--approve-create-repo)',
    };
  }

  return { allowed: true, reason: 'create-repo approved' };
}
