import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFoundryStateDir } from '@foundry/core/state.js';
import { getMonorepoRoot } from '@foundry/core/paths.js';
import { runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { runPause } from './pause.js';
import { runPlan } from './plan.js';
import { runResume } from './resume.js';
import { runSetup } from './setup.js';
import { runStatus } from './status.js';
import { runPublish } from './publish.js';
import { runApprove } from './approve.js';
import { runBuild } from './build.js';
import { runDaemon } from './daemon.js';
import { runNotify } from './notify.js';
import { runTui } from './tui.js';
import { runUpdate } from './update.js';
import { printHelp } from './help.js';

const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
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
  approve: runApprove,
  publish: runPublish,
  build: runBuild,
  tui: runTui,
  daemon: runDaemon,
  notify: runNotify,
  update: runUpdate,
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
