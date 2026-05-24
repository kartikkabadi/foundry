import { createPiRuntimeAdapter } from '@foundry/adapters/pi-runtime.js';
import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkPiRuntime(deps: DoctorDeps): DoctorCheck {
  const adapter = createPiRuntimeAdapter((cmd, args) => deps.exec(cmd, args));
  const probe = adapter.probe();

  if (probe.ok) {
    return {
      id: 'pi-runtime',
      status: 'pass',
      message: probe.message,
    };
  }

  return {
    id: 'pi-runtime',
    status: 'fail',
    message: probe.message,
    repair: 'Install Pi runtime and verify `pi run --version` succeeds.',
  };
}
