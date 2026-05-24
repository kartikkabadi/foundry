import { createCuadriverAdapter } from '@foundry/adapters/cuadriver.js';
import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkCuadriverComputerUse(deps: DoctorDeps, deep: boolean): DoctorCheck {
  const adapter = createCuadriverAdapter((cmd, args) => deps.exec(cmd, args));
  const probe = adapter.probe(deep);

  if (probe.status === 'pass') {
    return {
      id: 'cuadriver-computer-use',
      status: 'pass',
      message: probe.message,
    };
  }

  return {
    id: 'cuadriver-computer-use',
    status: 'warn',
    message: probe.message,
    repair: 'Install cua-driver for GUI automation, or skip computer-use features.',
  };
}
