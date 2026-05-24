import type { RunJson } from './types/run.js';

export class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateError';
  }
}

const BUILD_ALLOWED_STATUSES = new Set<RunJson['status']>(['approved', 'running', 'paused']);

export function assertApproved(run: RunJson): void {
  if (!BUILD_ALLOWED_STATUSES.has(run.status)) {
    throw new GateError(
      'Plan not approved. Complete `foundry plan` and run `foundry approve` first.',
    );
  }
}

export function assertPublishAllowed(run: RunJson, options?: { force?: boolean }): void {
  if (run.status === 'awaiting_approval' && !options?.force) {
    throw new GateError(
      'Plan is awaiting approval. Run `foundry approve` before publishing, or pass --force to override.',
    );
  }
}
