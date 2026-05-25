import type { RunBudget } from '../types/run.js';

export interface LoopSignal {
  actionKey: string;
  repeatCount: number;
  threshold: number;
  level: 'warn' | 'pause';
}

export interface LoopDetectionOptions {
  budget: RunBudget;
  warnThreshold?: number;
  pauseThreshold?: number;
}

const DEFAULT_THRESHOLDS: Record<RunBudget, { warn: number; pause: number }> = {
  quick: { warn: 3, pause: 5 },
  deep: { warn: 4, pause: 7 },
  marathon: { warn: 2, pause: 4 },
};

export class LoopDetector {
  private readonly counts = new Map<string, number>();
  private readonly warnThreshold: number;
  private readonly pauseThreshold: number;
  private warned = false;

  constructor(options: LoopDetectionOptions) {
    const defaults = DEFAULT_THRESHOLDS[options.budget];
    this.warnThreshold = options.warnThreshold ?? defaults.warn;
    this.pauseThreshold = options.pauseThreshold ?? defaults.pause;
  }

  record(actionKey: string): LoopSignal | null {
    const next = (this.counts.get(actionKey) ?? 0) + 1;
    this.counts.set(actionKey, next);

    if (next >= this.pauseThreshold) {
      return {
        actionKey,
        repeatCount: next,
        threshold: this.pauseThreshold,
        level: 'pause',
      };
    }

    if (!this.warned && next >= this.warnThreshold) {
      this.warned = true;
      return {
        actionKey,
        repeatCount: next,
        threshold: this.warnThreshold,
        level: 'warn',
      };
    }

    return null;
  }
}
