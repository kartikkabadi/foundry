import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkGitWorktrees(deps: DoctorDeps): DoctorCheck {
  const git = deps.exec('git', ['worktree', 'list']);
  if (git.ok) {
    return {
      id: 'git-worktrees',
      status: 'pass',
      message: 'Git worktree support available',
    };
  }

  return {
    id: 'git-worktrees',
    status: 'warn',
    message: 'Git worktrees unavailable (not a git repo or git missing).',
    repair: 'Initialize a git repository or install git.',
  };
}
