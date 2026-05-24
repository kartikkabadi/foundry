import type { DoctorCheck } from '@foundry/core/types/doctor.js';
import type { DoctorDeps } from '../deps.js';

const KNOWN_PLATFORMS = new Set<NodeJS.Platform>([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
]);

export function checkSystem(deps: DoctorDeps): DoctorCheck {
  const { platform, arch } = deps;

  if (!platform || !KNOWN_PLATFORMS.has(platform)) {
    return {
      id: 'system',
      status: 'fail',
      message: `Unsupported platform: ${platform || 'unknown'}`,
      repair: 'Use macOS, Linux, or Windows with Node 20+.',
    };
  }

  if (!arch) {
    return {
      id: 'system',
      status: 'fail',
      message: 'Could not detect CPU architecture.',
    };
  }

  return {
    id: 'system',
    status: 'pass',
    message: `${platform}/${arch}`,
  };
}
