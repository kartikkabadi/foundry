export type NotifyEvent = 'approval_waiting' | 'rate_limit_pause' | 'build_complete';

export interface NotifyPayload {
  event: NotifyEvent;
  title: string;
  body: string;
}

export interface NotifyPort {
  send(payload: NotifyPayload): Promise<void>;
}

export interface NotifyDryRunResult {
  channel: string;
  payload: NotifyPayload;
  valid: boolean;
}
