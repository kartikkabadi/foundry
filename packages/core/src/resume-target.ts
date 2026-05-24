import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RunJson } from './types/run.js';

export type ResumeTarget = 'plan' | 'build' | 'state-only';

/**
 * Resolve where a paused Run should re-enter (Run-level checkpoint routing).
 * Build orchestrator resume remains in @foundry/planner/build/orchestrate.
 */
export function resolveResumeTarget(run: RunJson, runDir: string): ResumeTarget {
  if (run.mode === 'build' || run.phase.startsWith('build_')) {
    return 'build';
  }

  if (run.mode === 'plan') {
    if (run.phase !== 'init' || run.artifacts.length > 0 || existsSync(join(runDir, 'intake.md'))) {
      return 'plan';
    }
  }

  return 'state-only';
}
