import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getMonorepoRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return dir;
}

export function getCliDistPath(fromUrl: string = import.meta.url): string {
  return join(getMonorepoRoot(fromUrl), 'packages', 'cli', 'dist', 'cli.js');
}
