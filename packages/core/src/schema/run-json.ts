import { z } from 'zod';
import type { RunJson } from '../types/run.js';
import { RUN_JSON_SCHEMA_VERSION } from '../types/run.js';

export class RunJsonValidationError extends Error {
  readonly code = 'MALFORMED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RunJsonValidationError';
  }
}

const runJsonSchema = z.object({
  schema_version: z.literal(RUN_JSON_SCHEMA_VERSION),
  run_id: z.string().min(1),
  foundry_version: z.string().min(1),
  mode: z.enum(['plan', 'build']),
  budget: z.enum(['quick', 'deep', 'marathon']),
  status: z.enum(['running', 'paused', 'awaiting_approval', 'approved', 'complete', 'failed']),
  phase: z.enum([
    'init',
    'research',
    'interview',
    'algorithm_pass',
    'synthesis',
    'awaiting_approval',
  ]),
  composer_speed: z.enum(['standard', 'fast']),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  agent_pass_budget: z.object({
    max_active: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
  artifacts: z.array(z.string()),
  blocked_actions: z.array(z.string()),
  next_actions: z.array(z.string()),
});

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'run.json';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function formatRunJsonValidationError(error: RunJsonValidationError): string {
  return error.message.replace(/^Invalid run\.json schema: /, '');
}

export function parseRunJson(value: unknown): RunJson {
  const result = runJsonSchema.safeParse(value);
  if (!result.success) {
    throw new RunJsonValidationError(`Invalid run.json schema: ${formatZodIssues(result.error)}`);
  }
  return result.data;
}

export { runJsonSchema };
