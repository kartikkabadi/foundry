import type { DoctorForTarget } from '../types/doctor.js';
import { createDefaultDeps } from '../doctor/deps.js';
import { printDoctorReport } from '../doctor/report.js';
import { runDoctorChecks } from '../doctor/run.js';

export interface ParsedDoctorArgs {
  forTarget: DoctorForTarget;
  deep: boolean;
  json: boolean;
  strict: boolean;
}

export function parseDoctorArgs(args: string[]): ParsedDoctorArgs {
  let forTarget: DoctorForTarget = 'all';
  let deep = false;
  let json = false;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--deep') {
      deep = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--for') {
      const value = args[++i];
      if (value === 'plan' || value === 'setup' || value === 'all') {
        forTarget = value;
      } else {
        console.error(`Invalid --for value: ${value ?? '(missing)'}. Use plan, setup, or all.`);
        process.exit(2);
      }
      continue;
    }

    console.error(`Unknown doctor option: ${arg}`);
    console.error('Usage: foundry doctor [--for plan|setup|all] [--deep] [--json] [--strict]');
    process.exit(2);
  }

  return { forTarget, deep, json, strict };
}

export function runDoctor(args: string[]): void {
  executeDoctor(args).catch((err) => {
    console.error('Doctor failed:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
}

export async function executeDoctor(args: string[]): Promise<void> {
  const parsed = parseDoctorArgs(args);
  const deps = createDefaultDeps();

  const report = await runDoctorChecks(deps, {
    forTarget: parsed.forTarget,
    deep: parsed.deep,
    strict: parsed.strict,
  });

  printDoctorReport(report, parsed.json);
  process.exit(report.exitCode);
}
