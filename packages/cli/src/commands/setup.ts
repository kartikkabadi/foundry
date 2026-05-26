import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { applyDoctorFix } from '@foundry/doctor/fix.js';
import { printDoctorReport } from '@foundry/doctor/report.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { MAX_AGENT_TURNS, runSetupAgentTurn } from '@foundry/planner/setup/suggestions.js';
import {
  loadNotificationsConfig,
  saveNotificationsConfig,
} from '@foundry/core/config/notifications.js';

const MAX_SETUP_ROUNDS = 5;

export type SetupMode = 'recommended' | 'expert';

export function parseSetupArgs(args: string[]): SetupMode {
  let mode: SetupMode = 'recommended';

  for (const arg of args) {
    if (arg === '--recommended') {
      mode = 'recommended';
      continue;
    }
    if (arg === '--expert') {
      mode = 'expert';
      continue;
    }
    console.error(`Unknown setup option: ${arg}`);
    console.error('Usage: foundry setup [--recommended|--expert]');
    process.exit(2);
  }

  return mode;
}

export function runSetup(args: string[]): void {
  const mode = parseSetupArgs(args);
  executeSetup(mode).catch((err) => {
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

async function executeSetup(mode: SetupMode): Promise<void> {
  const modeLabel = mode === 'expert' ? 'expert' : 'recommended';
  console.log(`Foundry setup (${modeLabel}) — doctor-guided readiness loop\n`);
  console.log('Safe repairs run via `doctor --fix` (Foundry-owned state only).');
  console.log('No silent installs or Pi/Cursor config edits.');
  console.log(
    'Pi Extension Pack guide: https://github.com/kartikkabadi/pi-composer-powerpack (agent-feedable setup path).\n',
  );

  const agentMode = process.env.FOUNDRY_SETUP_AGENT === '1' && mode !== 'expert';
  if (agentMode) {
    console.log(
      `Agent-guided setup: bounded suggestions enabled (max ${MAX_AGENT_TURNS} turns); doctor re-runs each round.\n`,
    );
  }

  if (process.stdin.isTTY && process.env.FOUNDRY_ENABLE_NOTIFICATIONS === '1') {
    const current = loadNotificationsConfig();
    const next = {
      macos: { enabled: process.platform === 'darwin' },
      webhook: { ...current.webhook },
    };
    saveNotificationsConfig(next);
    if (next.macos.enabled || next.webhook.enabled) {
      console.log('Notifications enabled in ~/.foundry/notifications.toml\n');
    }
  }

  let agentTurn = 0;

  for (let round = 1; round <= MAX_SETUP_ROUNDS; round++) {
    if (round > 1) {
      console.log(`\n--- Re-check (round ${round}/${MAX_SETUP_ROUNDS}) ---\n`);
    }

    const deps = createDefaultDeps();
    const fixResult = applyDoctorFix(deps);
    if (fixResult.fixed.length > 0) {
      console.log('Auto-repaired Foundry-owned state:');
      for (const item of fixResult.fixed) {
        console.log(`  ✓ ${item}`);
      }
      console.log('');
    }

    const report = await runDoctorChecks(deps, {
      forTarget: 'setup',
      deep: mode === 'expert',
      strict: false,
    });

    printDoctorReport(report, false);

    const failures = report.checks.filter((c) => c.status === 'fail');
    const warnings = report.checks.filter((c) => c.status === 'warn');

    if (failures.length === 0) {
      if (warnings.length > 0) {
        console.log('\nOptional capabilities (warn only):');
        for (const check of warnings) {
          console.log(`- [${check.id}] ${check.message}`);
        }
        if (mode === 'expert') {
          console.log('\nExpert: optional gaps are recorded as capability limits.');
        } else {
          console.log('\nRecommended: you can skip optional items; plan mode may still work.');
        }
      }
      console.log('\nSetup checks passed.');
      console.log('For plan mode: foundry doctor --for plan --deep');
      process.exit(report.exitCode);
    }

    console.log('\nFix these in dependency order:');
    if (agentMode && agentTurn < MAX_AGENT_TURNS) {
      agentTurn += 1;
      const suggestions = await runSetupAgentTurn(
        failures.map((c) => ({ id: c.id, message: c.message, repair: c.repair })),
        agentTurn,
      );
      suggestions.forEach((hint, index) => {
        console.log(`${index + 1}. ${hint}`);
      });
    } else {
      failures.forEach((check, index) => {
        console.log(`${index + 1}. [${check.id}] ${check.repair ?? check.message}`);
      });
    }

    console.log('\nSetup does not install packages or edit Pi/Cursor config automatically.');
    console.log('See docs/TROUBLESHOOTING.md for Pi, Cursor, and GitHub setup.');

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
