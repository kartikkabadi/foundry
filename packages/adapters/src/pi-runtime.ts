/** Pi runtime adapter — mock for CI, exec for live doctor. */

export interface PiRuntimeProbeResult {
  ok: boolean;
  message: string;
  version?: string;
}

export interface PiRuntimeAdapter {
  probe(): PiRuntimeProbeResult;
  invokeSmoke(cwd: string): Promise<PiRuntimeProbeResult>;
}

export type PiExecFn = (
  cmd: string,
  args: string[],
) => { ok: boolean; stdout: string; stderr: string };

export function createMockPiRuntimeAdapter(
  version = 'pi-mock-1.0.0',
): PiRuntimeAdapter {
  return {
    probe() {
      return { ok: true, message: `Pi runtime mock (${version})`, version };
    },
    async invokeSmoke() {
      return { ok: true, message: 'Pi mock smoke ok', version };
    },
  };
}

export function createExecPiRuntimeAdapter(exec: PiExecFn): PiRuntimeAdapter {
  return {
    probe() {
      const result = exec('pi', ['run', '--version']);
      if (result.ok) {
        return {
          ok: true,
          message: result.stdout.trim() || 'Pi runtime available',
          version: result.stdout.trim(),
        };
      }
      return {
        ok: false,
        message: 'Pi runtime not available (pi run --version failed).',
      };
    },
    async invokeSmoke(cwd: string) {
      const result = exec('pi', ['run', '--version']);
      if (!result.ok) {
        return {
          ok: false,
          message: `Pi smoke failed in ${cwd}: ${result.stderr || result.stdout}`,
        };
      }
      return {
        ok: true,
        message: 'Pi runtime smoke passed',
        version: result.stdout.trim(),
      };
    },
  };
}

export function createPiRuntimeAdapter(exec?: PiExecFn): PiRuntimeAdapter {
  if (process.env.FOUNDRY_PI_MOCK === '1' || !exec) {
    return createMockPiRuntimeAdapter();
  }
  return createExecPiRuntimeAdapter(exec);
}
