import type { BuildReviewStatus, BuildState } from '@foundry/core/types/build.js';

export class ReviewGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewGateError';
  }
}

export function enterReviewGate(build: BuildState, issueNumber: number): BuildState {
  const issues = build.issues.map((issue) =>
    issue.number === issueNumber
      ? { ...issue, status: 'awaiting_review' as const }
      : issue,
  );

  return {
    ...build,
    current_issue: issueNumber,
    review_status: 'pending',
    issues,
  };
}

export function approveReview(build: BuildState, issueNumber: number): BuildState {
  if (build.review_status !== 'pending') {
    throw new ReviewGateError('No review pending');
  }

  const issues = build.issues.map((issue) =>
    issue.number === issueNumber
      ? { ...issue, status: 'completed' as const }
      : issue,
  );

  return {
    ...build,
    current_issue: undefined,
    review_status: 'approved',
    issues,
  };
}

export function rejectReview(build: BuildState, issueNumber: number): BuildState {
  if (build.review_status !== 'pending') {
    throw new ReviewGateError('No review pending');
  }

  const issues = build.issues.map((issue) =>
    issue.number === issueNumber
      ? { ...issue, status: 'in_progress' as const }
      : issue,
  );

  return {
    ...build,
    review_status: 'rejected',
    issues,
  };
}

export function canMerge(build: BuildState): boolean {
  return build.review_status === 'approved';
}

export function isAwaitingReview(build: BuildState): boolean {
  return build.review_status === 'pending';
}

export function reviewStatusLabel(status?: BuildReviewStatus): string {
  switch (status) {
    case 'pending':
      return 'awaiting_review';
    case 'approved':
      return 'review_approved';
    case 'rejected':
      return 'review_rejected';
    default:
      return 'none';
  }
}
