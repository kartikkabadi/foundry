import type { BuildState } from '@foundry/core/types/build.js';

export class BuildGoalIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildGoalIncompleteError';
  }
}

export function deferIssue(build: BuildState, issueNumber: number, reason: string): BuildState {
  const issues = build.issues.map((issue) =>
    issue.number === issueNumber
      ? { ...issue, status: 'deferred' as const }
      : issue,
  );

  const deferred = build.deferred.includes(issueNumber)
    ? build.deferred
    : [...build.deferred, issueNumber];

  return {
    ...build,
    issues,
    deferred,
    goal_complete: false,
    current_issue: build.current_issue === issueNumber ? undefined : build.current_issue,
  };
}

export function resolveDeferred(build: BuildState, issueNumber: number): BuildState {
  const issues = build.issues.map((issue) =>
    issue.number === issueNumber ? { ...issue, status: 'pending' as const } : issue,
  );

  return {
    ...build,
    issues,
    deferred: build.deferred.filter((n) => n !== issueNumber),
    goal_complete: false,
  };
}

export function waiveDeferred(build: BuildState, issueNumber: number, approved: boolean): BuildState {
  if (!approved) {
    throw new BuildGoalIncompleteError('Waiving deferred issues requires explicit approval');
  }

  const issues = build.issues.map((issue) =>
    issue.number === issueNumber
      ? { ...issue, status: 'completed' as const }
      : issue,
  );

  return {
    ...build,
    issues,
    deferred: build.deferred.filter((n) => n !== issueNumber),
  };
}

export function evaluateBuildGoalComplete(build: BuildState): BuildState {
  const allDone = build.issues.every(
    (issue) => issue.status === 'completed' || issue.status === 'deferred',
  );
  const noUnresolvedDeferred = build.deferred.length === 0;

  return {
    ...build,
    goal_complete: allDone && noUnresolvedDeferred,
  };
}

export function formatDeferredSummary(build: BuildState): string {
  if (build.deferred.length === 0) {
    return 'No deferred issues.';
  }
  return `Deferred: ${build.deferred.map((n) => `#${n}`).join(', ')}`;
}

export function formatBuildSummary(build: BuildState): string {
  const completed = build.issues.filter((i) => i.status === 'completed').length;
  const lines = [
    `Build progress: ${completed}/${build.issues.length} issues completed`,
    formatDeferredSummary(build),
    `Build goal: ${build.goal_complete ? 'complete' : 'incomplete'}`,
  ];
  return lines.join('\n');
}
