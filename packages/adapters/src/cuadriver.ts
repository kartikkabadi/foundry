/** CuaDriver optional macOS GUI automation — warn-only by default. */

export interface CuadriverProbeResult {
  ok: boolean;
  status: 'pass' | 'warn';
  message: string;
  path?: string;
}

export interface CuadriverAdapter {
  probe(deep: boolean): CuadriverProbeResult;
}

export type WhichExecFn = (cmd: string, args: string[]) => { ok: boolean; stdout: string };

export function createMockCuadriverAdapter(path = '/usr/local/bin/cuadriver'): CuadriverAdapter {
  return {
    probe(deep: boolean) {
      if (process.env.FOUNDRY_CUADRIVER_MISSING === '1') {
        return {
          ok: false,
          status: deep ? 'warn' : 'warn',
          message: 'CuaDriver not found on PATH (optional macOS GUI automation).',
        };
      }
      return {
        ok: true,
        status: 'pass',
        message: `CuaDriver available at ${path}`,
        path,
      };
    },
  };
}

export function createExecCuadriverAdapter(exec: WhichExecFn): CuadriverAdapter {
  return {
    probe(deep: boolean) {
      const which = exec('which', ['cuadriver']);
      if (which.ok && which.stdout.trim()) {
        return {
          ok: true,
          status: 'pass',
          message: `CuaDriver available at ${which.stdout.trim()}`,
          path: which.stdout.trim(),
        };
      }
      return {
        ok: false,
        status: 'warn',
        message: 'CuaDriver not found on PATH (optional macOS GUI automation).',
      };
    },
  };
}

export function createCuadriverAdapter(exec?: WhichExecFn): CuadriverAdapter {
  if (process.env.FOUNDRY_CUADRIVER_MOCK === '1' || !exec) {
    return createMockCuadriverAdapter();
  }
  return createExecCuadriverAdapter(exec);
}
