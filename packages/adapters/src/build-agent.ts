import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFoundryAgent } from './foundry-agent.js';

export interface BuildAgentIssue {
  number: number;
  title: string;
}

export async function runBuildAgent(options: {
  issue: BuildAgentIssue;
  worktreePath: string;
  projectRoot: string;
  apiKey?: string;
}): Promise<{ outputFile: string; attemptedInstall?: boolean }> {
  const client = createFoundryAgent(options.apiKey);
  const prompt = [
    `You are implementing Foundry build issue #${options.issue.number}: ${options.issue.title}.`,
    'Write a minimal change in the worktree. Reply with a short summary when done.',
  ].join('\n');

  const summary = await client.prompt(prompt, options.worktreePath);
  const outputFile = join(options.worktreePath, `foundry-issue-${options.issue.number}.txt`);
  writeFileSync(outputFile, `${summary}\n`, 'utf8');
  return { outputFile, attemptedInstall: false };
}
