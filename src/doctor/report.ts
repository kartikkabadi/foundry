import { validateDoctorReport } from '../schema/doctor-report.js';
import type { DoctorCheck, DoctorReport } from '../types/doctor.js';

const STATUS_LABEL: Record<DoctorCheck['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  skip: 'SKIP',
};

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function formatDoctorTable(report: DoctorReport): string {
  const idWidth = Math.max(4, ...report.checks.map((c) => c.id.length));
  const statusWidth = 4;

  const lines: string[] = [
    `Foundry doctor (for=${report.for})`,
    '',
    `${pad('CHECK', idWidth)}  ${pad('STATUS', statusWidth)}  MESSAGE`,
    `${'-'.repeat(idWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}`,
  ];

  for (const check of report.checks) {
    const status = STATUS_LABEL[check.status];
    lines.push(`${pad(check.id, idWidth)}  ${pad(status, statusWidth)}  ${check.message}`);
    if (check.repair && check.status !== 'pass') {
      lines.push(`${' '.repeat(idWidth + statusWidth + 4)}→ ${check.repair}`);
    }
  }

  lines.push('');
  lines.push(`Exit code: ${report.exitCode}`);

  return lines.join('\n');
}

export function formatDoctorJson(report: DoctorReport): string {
  const validated = validateDoctorReport(report);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function printDoctorReport(report: DoctorReport, json: boolean): void {
  if (json) {
    process.stdout.write(formatDoctorJson(report));
    return;
  }

  console.log(formatDoctorTable(report));
}
