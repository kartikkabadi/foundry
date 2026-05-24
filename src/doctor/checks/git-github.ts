import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkGitGithub(deps: DoctorDeps): DoctorCheck {
  const gh = deps.exec('gh', ['auth', 'status']);
  if (gh.ok) {
    return {
      id: 'git-github',
      status: 'pass',
      message: 'GitHub CLI authenticated',
    };
  }

  const gitRemote = deps.exec('git', ['remote', 'get-url', 'origin']);
  if (!gitRemote.ok) {
    return {
      id: 'git-github',
      status: 'warn',
      message: 'No git remote or gh auth detected.',
      repair: 'Run `gh auth login` and ensure a GitHub remote is configured.',
    };
  }

  return {
    id: 'git-github',
    status: 'warn',
    message: 'Git remote present; gh auth not verified.',
    repair: 'Run `gh auth login` for GitHub integration.',
  };
}
