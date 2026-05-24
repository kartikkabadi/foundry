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
    'build_preflight',
    'build_executing',
    'build_review',
    'build_complete',
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
  proofs: z
    .array(
      z.object({
        issue: z.number().int().positive(),
        type: z.enum(['code', 'ui', 'docs', 'config', 'research']),
        path: z.string().min(1),
        valid: z.boolean(),
      }),
    )
    .optional(),
  build: z
    .object({
      current_issue: z.number().int().positive().optional(),
      issues: z.array(
        z.object({
          number: z.number().int().positive(),
          title: z.string().min(1),
          type: z.enum(['code', 'ui', 'docs', 'config', 'research']),
          status: z.enum([
            'pending',
            'in_progress',
            'awaiting_review',
            'completed',
            'deferred',
          ]),
          worktree: z.string().optional(),
          blocked_by: z.array(z.number().int().positive()),
        }),
      ),
      deferred: z.array(z.number().int().positive()),
      review_status: z.enum(['pending', 'approved', 'rejected']).optional(),
      goal_complete: z.boolean(),
    })
    .optional(),
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
