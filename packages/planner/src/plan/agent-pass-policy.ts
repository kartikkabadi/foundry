import { appendEvent } from '@foundry/core/comms/events.js';
import { resolveBudgetProfile } from '@foundry/core/config/budget-profiles.js';
import { LoopDetector } from '@foundry/core/loop/detection.js';
import { marathonPolicyForBudget, shouldMarathonReviewPause } from '@foundry/core/marathon/policy.js';
import { pauseRun, writeRunState, type RunRef } from '@foundry/core/state/run-writer.js';

export class AgentPassBudgetExhaustedError extends Error {
  constructor(message = 'Agent-pass budget exhausted; run paused at checkpoint.') {
    super(message);
    this.name = 'AgentPassBudgetExhaustedError';
  }
}

export class AgentPassCheckpointError extends Error {
  constructor(message = 'Agent-pass checkpoint interval reached; run paused for review.') {
    super(message);
    this.name = 'AgentPassCheckpointError';
  }
}

export function assertAgentPassBudgetAvailable(ref: RunRef, projectRoot: string): void {
  if (ref.run.agent_pass_budget.used >= ref.run.agent_pass_budget.limit) {
    pauseRun(projectRoot, 'Agent-pass budget exhausted — resume with `foundry resume`');
    throw new AgentPassBudgetExhaustedError();
  }
}

export function recordLoopSignal(
  ref: RunRef,
  projectRoot: string,
  phase: string,
  loopDetector: LoopDetector,
): void {
  const loopSignal = loopDetector.record(`${phase}:agent_pass`);
  if (!loopSignal) {
    return;
  }

  appendEvent(ref.runDir, {
    type: 'loop_detected',
    phase,
    summary: `Loop signal: ${loopSignal.actionKey} repeated ${loopSignal.repeatCount} times (threshold ${loopSignal.threshold})`,
    thread: 'plan.md',
  });

  if (loopSignal.level === 'pause') {
    pauseRun(projectRoot, 'Loop detected — resume with `foundry resume` after review');
    throw new AgentPassBudgetExhaustedError('Loop detected; run paused at checkpoint.');
  }
}

export function evaluateAgentPassAfterIncrement(
  ref: RunRef,
  projectRoot: string,
  phase: string,
): void {
  const used = ref.run.agent_pass_budget.used;
  const { limit } = ref.run.agent_pass_budget;

  if (used >= limit) {
    pauseRun(projectRoot, 'Agent-pass budget exhausted — resume with `foundry resume`');
    throw new AgentPassBudgetExhaustedError();
  }

  const profile = resolveBudgetProfile(ref.run.budget);
  const atCheckpointInterval = used > 0 && used % profile.checkpoint_interval_passes === 0;

  if (atCheckpointInterval) {
    pauseRun(
      projectRoot,
      `Checkpoint after ${used} agent passes — resume with \`foundry resume\``,
    );
    throw new AgentPassCheckpointError();
  }

  const marathonPolicy = marathonPolicyForBudget(ref.run.budget);
  if (marathonPolicy && shouldMarathonReviewPause(used, marathonPolicy)) {
    recordMarathonReviewPause(ref, used, marathonPolicy.checkpointIntervalPasses);
    pauseRun(projectRoot, 'Marathon review checkpoint — resume with `foundry resume`');
    appendEvent(ref.runDir, {
      type: 'decision_requested',
      phase,
      summary: 'Marathon scheduled review pause',
      thread: 'plan.md',
    });
    throw new AgentPassCheckpointError('Marathon review checkpoint — resume with `foundry resume`');
  }
}

function recordMarathonReviewPause(
  ref: RunRef,
  usedPasses: number,
  checkpointIntervalPasses: number,
): void {
  const existing = ref.run.marathon ?? {
    review_pause_at_passes: [],
    checkpoint_interval_passes: checkpointIntervalPasses,
  };
  if (!existing.review_pause_at_passes.includes(usedPasses)) {
    existing.review_pause_at_passes.push(usedPasses);
  }
  writeRunState({
    ...ref,
    run: {
      ...ref.run,
      marathon: existing,
      updated_at: new Date().toISOString(),
    },
  });
}
