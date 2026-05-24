import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDefaultDeps } from '../doctor/deps.js';
import { printDoctorReport } from '../doctor/report.js';
import { runDoctorChecks } from '../doctor/run.js';

const MAX_SETUP_ROUNDS = 5;

export function runSetup(_args: string[]): void {
  executeSetup().catch((err) => {
    console.error('foundry setup:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
}

async function promptContinue(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [Enter to re-run doctor / q to quit] `);
    return answer.trim().toLowerCase() !== 'q';
  } finally {
    rl.close();
  }
}

async function executeSetup(): Promise<void> {
  console.log('Foundry setup — doctor-guided readiness loop (Issue #3)\n');
  console.log('No silent installs. Fix items below manually, then re-run doctor.\n');

  for (let round = 1; round <= MAX_SETUP_ROUNDS; round++) {
    if (round > 1) {
      console.log(`\n--- Re-check (round ${round}/${MAX_SETUP_ROUNDS}) ---\n`);
    }

    const deps = createDefaultDeps();
    const report = await runDoctorChecks(deps, {
      forTarget: 'setup',
      deep: false,
      strict: false,
    });

    printDoctorReport(report, false);

    const failures = report.checks.filter((c) => c.status === 'fail');
    const warnings = report.checks.filter((c) => c.status === 'warn');

    if (failures.length === 0) {
      if (warnings.length > 0) {
        console.log('\nOptional warnings:');
        for (const check of warnings) {
          console.log(`- [${check.id}] ${check.message}`);
        }
      }
      console.log('\nSetup checks passed.');
      console.log('For plan mode readiness: foundry doctor --for plan --deep');
      process.exit(report.exitCode);
    }

    console.log('\nFix these in dependency order:');
    failures.forEach((check, index) => {
      console.log(`${index + 1}. [${check.id}] ${check.repair ?? check.message}`);
    });

    console.log('\nSetup does not install packages or edit Pi/Cursor config automatically.');

    if (round >= MAX_SETUP_ROUNDS) {
      console.log(`\nReached ${MAX_SETUP_ROUNDS} rounds. Re-run \`foundry setup\` after fixing items.`);
      process.exit(1);
    }

    const shouldContinue = await promptContinue('\nAfter applying fixes');
    if (!shouldContinue) {
      console.log('Setup paused. Re-run `foundry setup` when ready.');
      process.exit(1);
    }
  }

  process.exit(1);
}
