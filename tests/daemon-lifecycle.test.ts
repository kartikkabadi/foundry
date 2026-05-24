import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  daemonPidPath,
  daemonStart,
  daemonStatus,
  daemonStop,
} from '../packages/cli/src/commands/daemon.js';

describe('daemon lifecycle (#42)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-daemon-'));
    fs.mkdirSync(path.join(projectRoot, '.foundry'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('start/stop roundtrip manages pid file', () => {
    const start = daemonStart(projectRoot, 4242);
    assert.strictEqual(start.started, true);
    assert.ok(fs.existsSync(daemonPidPath(projectRoot)));
    assert.strictEqual(daemonStatus(projectRoot).running, true);

    const stop = daemonStop(projectRoot);
    assert.strictEqual(stop.stopped, true);
    assert.strictEqual(daemonStatus(projectRoot).running, false);
  });
});
