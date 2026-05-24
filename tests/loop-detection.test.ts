import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents } from '@foundry/core/comms/events.js';
import { LoopDetector } from '@foundry/core/loop/detection.js';

describe('loop detection (#35)', () => {
  it('repeated action triggers loop signal then pause level', () => {
    const detector = new LoopDetector({ budget: 'deep' });
    let last = null;
    for (let i = 0; i < 8; i++) {
      last = detector.record('tool:read_file');
    }
    assert.ok(last);
    assert.strictEqual(last.level, 'pause');
    assert.ok(last.repeatCount >= 7);
  });

  it('marathon uses stricter thresholds than deep', () => {
    const marathon = new LoopDetector({ budget: 'marathon' });
    const deep = new LoopDetector({ budget: 'deep' });
    let m: ReturnType<LoopDetector['record']> = null;
    let d: ReturnType<LoopDetector['record']> = null;
    for (let i = 0; i < 4; i++) {
      m = marathon.record('x');
      d = deep.record('x');
    }
    assert.strictEqual(m?.level, 'pause');
    assert.strictEqual(d?.level, 'warn');
  });

  it('loop events can be written to events.jsonl', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-loop-'));
    appendEvent(runDir, {
      type: 'loop_detected',
      phase: 'research',
      summary: 'Loop signal: tool:edit repeated 5 times',
      thread: 'plan.md',
    });
    const events = readEvents(runDir);
    assert.ok(events.some((e) => e.type === 'loop_detected'));
  });
});
