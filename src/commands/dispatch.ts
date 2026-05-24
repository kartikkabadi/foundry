import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureFoundryStateDir } from '../state.js';
import { runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { runPause } from './pause.js';
import { runPlan } from './plan.js';
import { runResume } from './resume.js';
import { runSetup } from './setup.js';
import { runStatus } from './status.js';
import { runPublish } from './publish.js';
import { printHelp } from './help.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

type CommandHandler = (args: string[]) => void;

const COMMANDS: Record<string, CommandHandler> = {
  doctor: runDoctor,
  setup: runSetup,
  init: runInit,
  plan: runPlan,
  status: runStatus,
  pause: runPause,
  resume: runResume,
  publish: runPublish,
  build: (args) => {
    console.error('foundry build: not implemented (post-v1)');
    process.exit(1);
  },
};

export function dispatch(argv: string[]): void {
  ensureFoundryStateDir();

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(pkg.version);
    process.exit(0);
  }

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    printHelp(pkg.version);
    process.exit(0);
  }

  const command = argv[0];
  const rest = argv.slice(1);

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error('Run "foundry --help" for usage.');
    process.exit(1);
  }

  handler(rest);
}
