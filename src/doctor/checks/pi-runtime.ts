import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkPiRuntime(deps: DoctorDeps): DoctorCheck {
  const runtime = deps.exec('pi', ['run', '--version']);
  if (runtime.ok) {
    return {
      id: 'pi-runtime',
      status: 'pass',
      message: runtime.stdout || 'Pi runtime available',
    };
  }

  return {
    id: 'pi-runtime',
    status: 'fail',
    message: 'Pi runtime not available (pi run --version failed).',
    repair: 'Install Pi runtime and verify `pi run --version` succeeds.',
  };
}
