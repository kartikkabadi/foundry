import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkCuadriverComputerUse(deps: DoctorDeps, _deep: boolean): DoctorCheck {
  const which = deps.exec('which', ['cuadriver']);
  if (which.ok && which.stdout) {
    return {
      id: 'cuadriver-computer-use',
      status: 'pass',
      message: `CuaDriver available at ${which.stdout}`,
    };
  }

  return {
    id: 'cuadriver-computer-use',
    status: 'warn',
    message: 'CuaDriver not found on PATH (optional macOS GUI automation).',
    repair: 'Install cua-driver for GUI automation, or skip computer-use features.',
  };
}
