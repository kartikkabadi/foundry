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

function phrasesOnDifferentBranches(summaries: string[], a: string, b: string): boolean {
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      const left = summaries[i]!;
      const right = summaries[j]!;
      if (
        (left.includes(a) && right.includes(b)) ||
        (left.includes(b) && right.includes(a))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Detect opposing recommendations across different swarm branch summaries. */
export function detectSwarmDisagreement(branches: SwarmBranchResult[]): SwarmDisagreement | null {
  if (branches.length < 2) {
    return null;
  }

  const summaries = branches.map((b) => b.summary.toLowerCase());

  for (const [a, b] of DISAGREEMENT_PAIRS) {
    if (phrasesOnDifferentBranches(summaries, a, b)) {
      return {
        summary: `Swarm branches disagree on approach (${a} vs ${b}). Orchestrator must resolve before build.`,
        prd_section: 'prd.md#scope',
      };
    }
  }

  return null;
}
