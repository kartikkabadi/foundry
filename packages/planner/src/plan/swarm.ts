import { appendEvent } from '@foundry/core/comms/events.js';
import type { RunRef } from '@foundry/core/state/run-writer.js';
import { writeArtifact } from './artifacts.js';

export interface SwarmBranchResult {
  branchId: string;
  citation: string;
  summary: string;
}

export interface SwarmResearchOptions {
  idea: string;
  branchCount: number;
  runSwarm: (branchId: string, idea: string) => Promise<SwarmBranchResult>;
}

export async function runResearchSwarm(
  ref: RunRef,
  options: SwarmResearchOptions,
): Promise<{ ref: RunRef; mergedMd: string }> {
  const branches: SwarmBranchResult[] = [];

  for (let i = 0; i < options.branchCount; i++) {
    const branchId = `swarm-${i + 1}`;
    appendEvent(ref.runDir, {
      type: 'agent_started',
      phase: 'swarm_research',
      summary: `Swarm branch ${branchId} started`,
      thread: 'research.md',
    });

    const result = await options.runSwarm(branchId, options.idea);
    branches.push(result);

    appendEvent(ref.runDir, {
      type: 'artifact_published',
      phase: 'swarm_research',
      summary: `Swarm branch ${branchId} published citation`,
      artifact: `swarm/${branchId}.md`,
      thread: 'research.md',
    });
  }

  const mergedMd = [
    '# Swarm research merge',
    '',
    `Idea: ${options.idea}`,
    '',
    ...branches.map(
      (b) =>
        `## ${b.branchId}\n\n**Citation:** ${b.citation}\n\n${b.summary}\n`,
    ),
  ].join('\n');

  writeArtifact(ref.runDir, 'research.md', mergedMd);
  writeArtifact(
    ref.runDir,
    'swarm-provenance.md',
    branches.map((b) => `- ${b.branchId}: ${b.citation}`).join('\n'),
  );

  return { ref, mergedMd };
}
