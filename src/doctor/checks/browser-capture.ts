import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkBrowserCapture(deps: DoctorDeps): DoctorCheck {
  const playwright = deps.exec('npx', ['playwright', '--version']);
  if (playwright.ok) {
    return {
      id: 'browser-capture',
      status: 'pass',
      message: `Browser capture probe ok (${playwright.stdout || 'playwright available'})`,
    };
  }

  return {
    id: 'browser-capture',
    status: 'warn',
    message: 'Browser capture unavailable (playwright probe failed).',
    repair: 'Install Playwright for reference capture, or skip browser references in plan.',
  };
}
