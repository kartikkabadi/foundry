export type ProofType = 'code' | 'ui' | 'docs' | 'config' | 'research';

export type IssueBuildStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_review'
  | 'completed'
  | 'deferred';

export type BuildReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ProofRecord {
  issue: number;
  type: ProofType;
  path: string;
  valid: boolean;
}

export interface BuildIssueState {
  number: number;
  title: string;
  type: ProofType;
  status: IssueBuildStatus;
  worktree?: string;
  blocked_by: number[];
}

export interface BuildState {
  current_issue?: number;
  issues: BuildIssueState[];
  deferred: number[];
  review_status?: BuildReviewStatus;
  goal_complete: boolean;
}

export interface IssuePlanNode {
  number: number;
  title: string;
  type: ProofType;
  blocked_by: number[];
  body: string;
}

export interface AutonomyProfile {
  name: 'safe' | 'productive' | 'custom';
  allow_install: boolean;
  allow_commit: boolean;
}

export type AutonomyAction = 'npm_install' | 'git_commit';

export interface AutonomyDecision {
  action: AutonomyAction;
  allowed: boolean;
  reason: string;
}
