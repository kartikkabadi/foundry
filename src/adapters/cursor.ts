/** Cursor SDK boundary (Issue #5). H0: interface + throwing stub only. */

export interface ComposerSmokeResult {
  ok: boolean;
  message: string;
}

export interface CursorAdapter {
  smokeComposerStandard(options: { timeoutMs: number }): Promise<ComposerSmokeResult>;
}

export class CursorAdapterNotImplementedError extends Error {
  constructor(message = 'Cursor adapter not implemented (Issue #5)') {
    super(message);
    this.name = 'CursorAdapterNotImplementedError';
  }
}

export function createCursorAdapter(): CursorAdapter {
  return {
    async smokeComposerStandard(): Promise<ComposerSmokeResult> {
      throw new CursorAdapterNotImplementedError();
    },
  };
}
