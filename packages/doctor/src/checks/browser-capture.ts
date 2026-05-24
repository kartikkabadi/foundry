import { createBrowserCaptureAdapter } from '@foundry/adapters/browser-capture.js';
import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkBrowserCapture(deps: DoctorDeps): DoctorCheck {
  const adapter = createBrowserCaptureAdapter((cmd, args) => deps.exec(cmd, args));
  const probe = adapter.probe();

  if (probe.ok) {
    return {
      id: 'browser-capture',
      status: 'pass',
      message: probe.message,
    };
  }

  return {
    id: 'browser-capture',
    status: 'warn',
    message: probe.message,
    repair: 'Install Playwright for reference capture, or skip browser references in plan.',
  };
}
