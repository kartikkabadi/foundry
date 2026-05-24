import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkPiCli(deps: DoctorDeps): DoctorCheck {
  const version = deps.exec('pi', ['--version']);
  if (version.ok) {
    return {
      id: 'pi-cli',
      status: 'pass',
      message: version.stdout || 'pi CLI available',
    };
  }

  const which = deps.exec('which', ['pi']);
  if (which.ok && which.stdout) {
    return {
      id: 'pi-cli',
      status: 'pass',
      message: `pi found at ${which.stdout}`,
    };
  }

  return {
    id: 'pi-cli',
    status: 'fail',
    message: 'Pi CLI not found on PATH.',
    repair: 'Install Pi and ensure `pi` is available. See Pi setup docs.',
  };
}
