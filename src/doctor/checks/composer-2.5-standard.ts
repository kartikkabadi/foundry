import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';
import { CursorAdapterNotImplementedError } from '../../adapters/cursor.js';

const SMOKE_TIMEOUT_MS = 60_000;

export async function checkComposer25Standard(
  deps: DoctorDeps,
  deep: boolean,
): Promise<DoctorCheck> {
  if (!deep) {
    return {
      id: 'composer-2.5-standard',
      status: 'skip',
      message: 'Composer smoke skipped (use --deep to verify).',
    };
  }

  const apiKey = deps.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return {
      id: 'composer-2.5-standard',
      status: 'fail',
      message: 'Cannot smoke Composer without CURSOR_API_KEY.',
      repair: 'Set CURSOR_API_KEY, then re-run `foundry doctor --deep`.',
    };
  }

  if (!deps.resolveModule('@cursor/sdk', deps.foundryRoot)) {
    return {
      id: 'composer-2.5-standard',
      status: 'fail',
      message: '@cursor/sdk required for Composer smoke.',
      repair: 'Run `sfw npm install @cursor/sdk`, then re-run with --deep.',
    };
  }

  try {
    const result = await deps.cursorAdapter.smokeComposerStandard({
      timeoutMs: SMOKE_TIMEOUT_MS,
    });

    if (result.ok) {
      return {
        id: 'composer-2.5-standard',
        status: 'pass',
        message: result.message || 'Composer 2.5 Standard smoke passed',
      };
    }

    return {
      id: 'composer-2.5-standard',
      status: 'fail',
      message: result.message || 'Composer 2.5 Standard smoke failed.',
      repair: 'Verify Cursor API access and Composer 2.5 availability.',
    };
  } catch (err) {
    if (err instanceof CursorAdapterNotImplementedError) {
      return {
        id: 'composer-2.5-standard',
        status: 'fail',
        message: 'Composer smoke adapter not wired (Issue #5).',
        repair: 'Install @cursor/sdk and complete the Cursor adapter.',
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      id: 'composer-2.5-standard',
      status: 'fail',
      message: `Composer smoke error: ${message}`,
      repair: 'Re-run `foundry doctor --deep` after fixing Cursor setup.',
    };
  }
}
