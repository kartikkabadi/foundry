export interface CreateRepoResult {
  url: string;
  name: string;
}

export interface CreateRepoRunner {
  (name: string, options: { private: boolean }): Promise<CreateRepoResult>;
}

export async function createPrivateGitHubRepo(
  name: string,
  runner: CreateRepoRunner,
): Promise<CreateRepoResult> {
  return runner(name, { private: true });
}
