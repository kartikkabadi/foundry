import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkCursorSdk(deps: DoctorDeps): DoctorCheck {
  const apiKey = deps.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return {
      id: 'cursor-sdk',
      status: 'fail',
      message: 'CURSOR_API_KEY is not set.',
      repair: 'Export CURSOR_API_KEY in your shell (never commit or log it).',
    };
  }

  if (!deps.resolveModule('@cursor/sdk', deps.foundryRoot)) {
    return {
      id: 'cursor-sdk',
      status: 'fail',
      message: '@cursor/sdk is not installed.',
      repair: 'Run `sfw npm install @cursor/sdk` in the Foundry repo.',
    };
  }

  return {
    id: 'cursor-sdk',
    status: 'pass',
    message: 'CURSOR_API_KEY set, @cursor/sdk resolves',
  };
}
