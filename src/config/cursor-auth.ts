import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CursorApiKeySource = 'env' | 'pi-auth' | 'none';

export interface CursorApiKeyResolution {
  apiKey: string | undefined;
  source: CursorApiKeySource;
}

export interface ResolveCursorApiKeyOptions {
  env?: NodeJS.ProcessEnv;
  piAuthPath?: string;
}

/** Pi stores credentials at ~/.pi/agent/auth.json (see Pi coding-agent docs). */
export function getDefaultPiAuthPath(): string {
  const agentDir = process.env.PI_AGENT_DIR?.trim();
  if (agentDir) {
    return join(agentDir, 'auth.json');
  }
  return join(homedir(), '.pi', 'agent', 'auth.json');
}

type PiAuthEntry = {
  type?: string;
  key?: string;
};

export function readPiCursorApiKey(authPath: string): string | undefined {
  if (!existsSync(authPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(authPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, PiAuthEntry>;
    const cursor = data.cursor;
    const key = cursor?.key?.trim();
    if (!key) {
      return undefined;
    }
    if (cursor.type && cursor.type !== 'api_key') {
      return undefined;
    }
    return key;
  } catch {
    return undefined;
  }
}

/**
 * Resolution order: CURSOR_API_KEY env → Pi auth.json cursor key.
 * Never logs or returns key material in error messages — callers use source only.
 */
export function resolveCursorApiKey(
  options: ResolveCursorApiKeyOptions = {},
): CursorApiKeyResolution {
  const env = options.env ?? process.env;
  const fromEnv = env.CURSOR_API_KEY?.trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'env' };
  }

  const authPath = options.piAuthPath ?? getDefaultPiAuthPath();
  const fromPi = readPiCursorApiKey(authPath);
  if (fromPi) {
    return { apiKey: fromPi, source: 'pi-auth' };
  }

  return { apiKey: undefined, source: 'none' };
}

export function describeCursorApiKeySource(source: CursorApiKeySource): string {
  switch (source) {
    case 'env':
      return 'CURSOR_API_KEY environment variable';
    case 'pi-auth':
      return 'Pi auth.json (cursor provider)';
    case 'none':
      return 'not configured';
  }
}
