import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
  /** Run branches concurrently (safe when runSwarm does not mutate shared run state). */
  parallel?: boolean;
  runSwarm: (branchId: string, idea: string) => Promise<SwarmBranchResult>;
}

/** Run parallel research branches and merge citations into research.md. */
export async function runResearchSwarm(
  ref: RunRef,
  options: SwarmResearchOptions,
): Promise<{ ref: RunRef; mergedMd: string; branches: SwarmBranchResult[] }> {
  const branchIds = Array.from({ length: options.branchCount }, (_, i) => `swarm-${i + 1}`);

  const runBranch = async (branchId: string): Promise<SwarmBranchResult> => {
    appendEvent(ref.runDir, {
      type: 'agent_started',
      phase: 'swarm_research',
      summary: `Swarm branch ${branchId} started`,
      thread: 'research.md',
    });

    const result = await options.runSwarm(branchId, options.idea);

    return result;
  };

  const branches = options.parallel
    ? await Promise.all(branchIds.map(runBranch))
    : await branchIds.reduce(
        async (acc, branchId) => [...(await acc), await runBranch(branchId)],
        Promise.resolve([] as SwarmBranchResult[]),
      );

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

  mkdirSync(join(ref.runDir, 'swarm'), { recursive: true });
  for (const branch of branches) {
    const artifactPath = `swarm/${branch.branchId}.md`;
    writeArtifact(ref.runDir, artifactPath, [
      `# ${branch.branchId}`,
      '',
      `**Citation:** ${branch.citation}`,
      '',
      branch.summary,
      '',
    ].join('\n'));
    appendEvent(ref.runDir, {
      type: 'artifact_published',
      phase: 'swarm_research',
      summary: `Swarm branch ${branch.branchId} published citation`,
      artifact: artifactPath,
      thread: 'research.md',
    });
  }

  return { ref, mergedMd, branches };
}
