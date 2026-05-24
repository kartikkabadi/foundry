import { createDefaultDeps } from '../doctor/deps.js';
import { printDoctorReport } from '../doctor/report.js';
import { runDoctorChecks } from '../doctor/run.js';

export function runSetup(_args: string[]): void {
  executeSetup().catch((err) => {
    console.error('foundry setup:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
}

async function executeSetup(): Promise<void> {
  console.log('Foundry setup (hackathon stub — full setup is Issue #3)\n');
  console.log('Running doctor --for setup…\n');

  const deps = createDefaultDeps();
  const report = await runDoctorChecks(deps, {
    forTarget: 'setup',
    deep: false,
    strict: false,
  });

  printDoctorReport(report, false);

  const failures = report.checks.filter((c) => c.status === 'fail');
  const warnings = report.checks.filter((c) => c.status === 'warn');

  if (failures.length > 0) {
    console.log('\nSuggested fixes (in order):');
    failures.forEach((check, index) => {
      console.log(`${index + 1}. [${check.id}] ${check.repair ?? check.message}`);
    });
    console.log('\nRe-run: foundry doctor --for setup');
    console.log('For plan readiness: foundry doctor --for plan --deep');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log('\nOptional warnings:');
    for (const check of warnings) {
      console.log(`- [${check.id}] ${check.message}`);
    }
  }

  console.log('\nSetup checks passed. For plan mode, run: foundry doctor --for plan --deep');
  process.exit(report.exitCode);
}
