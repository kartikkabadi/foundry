import { isRateLimitError, RateLimitCheckpointError } from '@foundry/adapters/agent-errors.js';
import { dispatchRunNotification } from '@foundry/adapters/notify/dispatch.js';
import { COMPOSER_MODEL_STANDARD } from '@foundry/adapters/foundry-agent.js';
import { appendEvent } from '@foundry/core/comms/events.js';
import { pauseRun, writeRunState, type RunRef } from '@foundry/core/state/run-writer.js';

export async function invokeAgentWithCheckpoint(options: {
  ref: RunRef;
  projectRoot: string;
  phase: string;
  modelId?: string;
  fn: () => Promise<string>;
}): Promise<{ ref: RunRef; result: string }> {
  const modelId = options.modelId ?? COMPOSER_MODEL_STANDARD;

  try {
    const result = await options.fn();
    return { ref: options.ref, result };
  } catch (err) {
    if (!isRateLimitError(err)) {
      throw err;
    }

    appendEvent(options.ref.runDir, {
      type: 'blocker_reported',
      phase: options.phase,
      summary: `Composer rate limited — paused (model ${modelId})`,
      thread: `${options.ref.run.mode}.md`,
    });

    const paused = pauseRun(
      options.projectRoot,
      `Composer rate limited — resume with \`foundry resume\` (model: ${modelId})`,
    );

    const run = writeRunState({
      ...paused,
      run: {
        ...paused.run,
        composer_speed: paused.run.composer_speed,
      },
    });

    await dispatchRunNotification({
      event: 'rate_limit_pause',
      title: 'Foundry',
      body: `Composer rate limited — resume with foundry resume (model: ${modelId})`,
    }).catch(() => undefined);

    throw new RateLimitCheckpointError({ ...paused, run }, modelId);
  }
}
