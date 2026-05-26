import { execFileSync } from 'node:child_process';

export interface CreateRepoResult {
  url: string;
  name: string;
}

export interface CreateRepoRunner {
  (name: string, options: { private: boolean }): Promise<CreateRepoResult>;
}

export function parseGhRepoCreateUrl(stdout: string): string {
  const url = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^https:\/\/github\.com\//.test(line));
  if (!url) {
    throw new Error('gh repo create did not return a repository URL');
  }
  return url;
}

export function createRepoWithGhCli(name: string): CreateRepoResult {
  const stdout = execFileSync('gh', ['repo', 'create', name, '--private'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { name, url: parseGhRepoCreateUrl(stdout) };
}

export async function createPrivateGitHubRepo(
  name: string,
  runner: CreateRepoRunner,
): Promise<CreateRepoResult> {
  return runner(name, { private: true });
}
