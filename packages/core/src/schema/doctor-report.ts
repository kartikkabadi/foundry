import { z } from 'zod';
import type { DoctorReport } from '../types/doctor.js';
import { DOCTOR_SCHEMA_VERSION } from '../types/doctor.js';

export class DoctorReportValidationError extends Error {
  readonly code = 'MALFORMED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DoctorReportValidationError';
  }
}

const doctorCheckIdSchema = z.enum([
  'system',
  'node-package-manager',
  'foundry-install',
  'pi-cli',
  'cursor-sdk',
  'composer-2.5-standard',
  'project-foundry-config',
  'git-github',
  'git-worktrees',
]);

const doctorReportSchema = z.object({
  schemaVersion: z.literal(DOCTOR_SCHEMA_VERSION),
  for: z.enum(['plan', 'setup', 'all']),
  checks: z.array(
    z.object({
      id: doctorCheckIdSchema,
      status: z.enum(['pass', 'fail', 'warn', 'skip']),
      message: z.string(),
      repair: z.string().optional(),
    }),
  ),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  generatedAt: z.string().min(1),
});

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'doctor report';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function parseDoctorReport(value: unknown): DoctorReport {
  const result = doctorReportSchema.safeParse(value);
  if (!result.success) {
    throw new DoctorReportValidationError(
      `Invalid doctor report schema: ${formatZodIssues(result.error)}`,
    );
  }
  return result.data;
}

export function validateDoctorReport(report: DoctorReport): DoctorReport {
  return parseDoctorReport(report);
}

export { doctorReportSchema };
