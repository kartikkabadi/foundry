import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkNodePackageManager(deps: DoctorDeps): DoctorCheck {
  const npm = deps.exec('npm', ['--version']);
  if (npm.ok) {
    return {
      id: 'node-package-manager',
      status: 'pass',
      message: `npm ${npm.stdout}`,
    };
  }

  const pnpm = deps.exec('pnpm', ['--version']);
  if (pnpm.ok) {
    return {
      id: 'node-package-manager',
      status: 'pass',
      message: `pnpm ${pnpm.stdout}`,
    };
  }

  return {
    id: 'node-package-manager',
    status: 'fail',
    message: 'Neither npm nor pnpm is available on PATH.',
    repair: 'Install Node.js 20+ (includes npm) or install pnpm.',
  };
}
