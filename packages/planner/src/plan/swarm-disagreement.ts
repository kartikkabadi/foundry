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

function branchIndexWithPhrase(summaries: string[], phrase: string): number {
  return summaries.findIndex((s) => s.includes(phrase));
}

/** Detect opposing recommendations across different swarm branch summaries. */
export function detectSwarmDisagreement(branches: SwarmBranchResult[]): SwarmDisagreement | null {
  if (branches.length < 2) {
    return null;
  }

  const summaries = branches.map((b) => b.summary.toLowerCase());

  for (const [a, b] of DISAGREEMENT_PAIRS) {
    const indexA = branchIndexWithPhrase(summaries, a);
    const indexB = branchIndexWithPhrase(summaries, b);
    if (indexA >= 0 && indexB >= 0 && indexA !== indexB) {
      return {
        summary: `Swarm branches disagree on approach (${a} vs ${b}). Orchestrator must resolve before build.`,
        prd_section: 'prd.md#scope',
      };
    }
  }

  return null;
}
