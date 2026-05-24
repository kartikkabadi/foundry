#!/usr/bin/env node
import { ensureFoundryStateDir } from './state.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

ensureFoundryStateDir();

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`foundry v${pkg.version}

Usage: foundry <command> [options]

Commands (v1):
  doctor     Run capability checks
  setup      Agent-guided setup
  plan       Create planning artifacts
  status     Show current run status
  pause      Pause an active run
  resume     Resume a paused run
  build      (later) Execute approved build

Options:
  --version, -v   Print version
  --help, -h      Show this help

See docs for details.`);
  process.exit(0);
}

console.error('Unknown command. Use --help for usage.');
process.exit(1);
