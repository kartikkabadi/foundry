export const EVENTS_SCHEMA_VERSION = 1 as const;

export type FoundryEventType =
  | 'agent_started'
  | 'message_sent'
  | 'artifact_published'
  | 'blocker_reported'
  | 'conflict_raised'
  | 'decision_requested'
  | 'agent_finished'
  | 'handoff_published'
  | 'loop_detected';

export interface FoundryEventRecord {
  schema_version: typeof EVENTS_SCHEMA_VERSION;
  ts: string;
  type: FoundryEventType;
  phase: string;
  summary: string;
  artifact?: string;
  thread?: string;
}

export type FoundryEventInput = Pick<
  FoundryEventRecord,
  'type' | 'phase' | 'summary'
> &
  Partial<Pick<FoundryEventRecord, 'artifact' | 'thread'>>;
