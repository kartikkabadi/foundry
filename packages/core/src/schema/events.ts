import { z } from 'zod';
import type { FoundryEventRecord } from '../types/events.js';
import { EVENTS_SCHEMA_VERSION } from '../types/events.js';

export class EventValidationError extends Error {
  readonly code = 'MALFORMED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}

const eventRecordSchema = z.object({
  schema_version: z.literal(EVENTS_SCHEMA_VERSION),
  ts: z.string().min(1),
  type: z.enum([
    'agent_started',
    'message_sent',
    'artifact_published',
    'blocker_reported',
    'conflict_raised',
    'decision_requested',
    'agent_finished',
    'handoff_published',
    'loop_detected',
  ]),
  phase: z.string().min(1),
  summary: z.string().min(1),
  artifact: z.string().optional(),
  thread: z.string().optional(),
});

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'event';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function parseEventRecord(value: unknown): FoundryEventRecord {
  const result = eventRecordSchema.safeParse(value);
  if (!result.success) {
    throw new EventValidationError(`Invalid event record: ${formatZodIssues(result.error)}`);
  }
  return result.data;
}

export { eventRecordSchema };
