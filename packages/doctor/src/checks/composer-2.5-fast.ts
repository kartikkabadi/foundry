import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import { resolveCursorApiKey } from '@foundry/core/config/cursor-auth.js';
import type { DoctorDeps } from '../deps.js';

const SMOKE_TIMEOUT_MS = 60_000;

export interface ComposerFastCheckOptions {
  deep: boolean;
  explicit: boolean;
}

export async function checkComposer25Fast(
  deps: DoctorDeps,
  options: ComposerFastCheckOptions,
): Promise<DoctorCheck> {
  if (!options.deep) {
    return {
      id: 'composer-2.5-fast',
      status: 'skip',
      message: 'Composer Fast smoke skipped (use --deep to verify).',
    };
  }

  const resolution = resolveCursorApiKey({ env: deps.env, piAuthPath: deps.piAuthPath });
  if (!resolution.apiKey) {
    const status = options.explicit ? 'fail' : 'warn';
    return {
      id: 'composer-2.5-fast',
      status,
      message: 'Cannot smoke Composer Fast without a Cursor API key.',
      repair: 'Set CURSOR_API_KEY or configure Cursor in Pi, then re-run with --deep.',
    };
  }

  if (!deps.resolveModule('@cursor/sdk', deps.foundryRoot)) {
    const status = options.explicit ? 'fail' : 'warn';
    return {
      id: 'composer-2.5-fast',
      status,
      message: '@cursor/sdk required for Composer Fast smoke.',
      repair: 'Run `npm install @cursor/sdk` and re-run with --deep.',
    };
  }

  const result = await deps.cursorAdapter.smokeComposerFast({ timeoutMs: SMOKE_TIMEOUT_MS });

  if (result.ok) {
    return {
      id: 'composer-2.5-fast',
      status: 'pass',
      message: result.message || 'Composer 2.5 Fast smoke passed',
    };
  }

  if (options.explicit) {
    return {
      id: 'composer-2.5-fast',
      status: 'fail',
      message: result.message || 'Composer 2.5 Fast smoke failed.',
      repair: 'Verify Composer Fast availability or use Standard only.',
    };
  }

  return {
    id: 'composer-2.5-fast',
    status: 'warn',
    message: result.message || 'Composer 2.5 Fast unavailable (warn-only unless --composer-fast).',
    repair: 'Use composer-2.5 Standard by default, or pass --composer-fast after explicit approval.',
  };
}
