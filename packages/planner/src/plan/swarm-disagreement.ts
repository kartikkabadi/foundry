import type { SwarmBranchResult } from './swarm.js';

const DISAGREEMENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['mobile-only', 'desktop-first'],
  ['monolith', 'microservices'],
  ['defer launch', 'ship now'],
];

export interface SwarmDisagreement {
  summary: string;
  prd_section: string;
}

/** Detect opposing recommendations across swarm branch summaries. */
export function detectSwarmDisagreement(branches: SwarmBranchResult[]): SwarmDisagreement | null {
  if (branches.length < 2) {
    return null;
  }

  const summaries = branches.map((b) => b.summary.toLowerCase());

  for (const [a, b] of DISAGREEMENT_PAIRS) {
    const hasA = summaries.some((s) => s.includes(a));
    const hasB = summaries.some((s) => s.includes(b));
    if (hasA && hasB) {
      return {
        summary: `Swarm branches disagree on approach (${a} vs ${b}). Orchestrator must resolve before build.`,
        prd_section: 'prd.md#scope',
      };
    }
  }

  return null;
}
