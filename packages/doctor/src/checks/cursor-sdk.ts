import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import {
  describeCursorApiKeySource,
  resolveCursorApiKey,
} from '@foundry/core/config/cursor-auth.js';
import type { DoctorDeps } from '../deps.js';

export function checkCursorSdk(deps: DoctorDeps): DoctorCheck {
  const resolution = resolveCursorApiKey({ env: deps.env, piAuthPath: deps.piAuthPath });
  if (!resolution.apiKey) {
    return {
      id: 'cursor-sdk',
      status: 'fail',
      message: 'Cursor API key not configured.',
      repair:
        'Set CURSOR_API_KEY or configure Cursor in Pi (~/.pi/agent/auth.json). Never commit or log keys.',
    };
  }

  if (!deps.resolveModule('@cursor/sdk', deps.foundryRoot)) {
    return {
      id: 'cursor-sdk',
      status: 'fail',
      message: '@cursor/sdk is not installed.',
      repair: 'Run `sfw npm install @cursor/sdk` in the Foundry repo, then `npm rebuild sqlite3`.',
    };
  }

  return {
    id: 'cursor-sdk',
    status: 'pass',
    message: `Cursor API key via ${describeCursorApiKeySource(resolution.source)}, @cursor/sdk resolves`,
  };
}
