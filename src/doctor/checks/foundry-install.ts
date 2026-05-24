import { join } from 'node:path';
import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';

function parseNodeMajor(version: string): number | null {
  const match = /^v(\d+)/.exec(version);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function checkFoundryInstall(deps: DoctorDeps): DoctorCheck {
  const major = parseNodeMajor(deps.nodeVersion);
  if (major === null || major < 20) {
    return {
      id: 'foundry-install',
      status: 'fail',
      message: `Node ${deps.nodeVersion} — requires Node ≥20.`,
      repair: 'Upgrade Node.js to version 20 or later.',
    };
  }

  const cliPath = join(deps.foundryRoot, 'dist', 'cli.js');
  if (!deps.fileExists(cliPath)) {
    return {
      id: 'foundry-install',
      status: 'fail',
      message: 'Foundry CLI not built (dist/cli.js missing).',
      repair: 'Run `npm run build` in the Foundry repo.',
    };
  }

  return {
    id: 'foundry-install',
    status: 'pass',
    message: `Node ${deps.nodeVersion}, CLI built`,
  };
}
