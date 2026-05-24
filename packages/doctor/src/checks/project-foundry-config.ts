import { join } from 'node:path';
import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

export function checkProjectFoundryConfig(deps: DoctorDeps): DoctorCheck {
  const configPath = join(deps.cwd, '.foundry', 'config.toml');

  if (deps.fileExists(configPath)) {
    return {
      id: 'project-foundry-config',
      status: 'pass',
      message: '.foundry/config.toml present',
    };
  }

  return {
    id: 'project-foundry-config',
    status: 'warn',
    message: '.foundry/config.toml missing (expected before plan).',
    repair: 'Run `foundry init` in this project.',
  };
}
