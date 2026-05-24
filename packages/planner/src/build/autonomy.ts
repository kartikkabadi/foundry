import { readFileSync } from 'node:fs';
import { appendEvent } from '@foundry/core/comms/events.js';
import type { AutonomyAction, AutonomyDecision, AutonomyProfile } from '@foundry/core/types/build.js';

const PROFILE_LINE = /^default\s*=\s*"(safe|productive|custom)"/im;

export function parseAutonomyProfile(contractMarkdown: string): AutonomyProfile {
  const match = contractMarkdown.match(PROFILE_LINE);
  const name = (match?.[1] ?? 'productive') as AutonomyProfile['name'];

  switch (name) {
    case 'safe':
      return { name, allow_install: false, allow_commit: false };
    case 'custom':
      return { name, allow_install: true, allow_commit: false };
    case 'productive':
    default:
      return { name: 'productive', allow_install: true, allow_commit: true };
  }
}

export function loadAutonomyProfileFromRun(runDir: string): AutonomyProfile {
  const contractPath = `${runDir}/autonomy-contract.md`;
  const markdown = readFileSync(contractPath, 'utf8');
  return parseAutonomyProfile(markdown);
}

export function evaluateAutonomyAction(
  profile: AutonomyProfile,
  action: AutonomyAction,
  approved = false,
): AutonomyDecision {
  if (action === 'npm_install') {
    if (profile.allow_install || approved) {
      return { action, allowed: true, reason: 'install permitted' };
    }
    return {
      action,
      allowed: false,
      reason: 'npm install blocked by autonomy profile (safe mode)',
    };
  }

  if (profile.allow_commit || approved) {
    return { action, allowed: true, reason: 'commit permitted' };
  }

  return {
    action,
    allowed: false,
    reason: 'git commit blocked by autonomy profile (safe mode)',
  };
}

export function auditAutonomyEvent(runDir: string, decision: AutonomyDecision): void {
  appendEvent(runDir, {
    type: decision.allowed ? 'agent_finished' : 'blocker_reported',
    phase: 'build_executing',
    summary: `${decision.action}: ${decision.reason}`,
  });
}
