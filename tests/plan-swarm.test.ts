import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createRun } from '@foundry/core/state/run-writer.js';
import { runResearchSwarm } from '@foundry/planner/plan/swarm.js';

describe('plan swarm (#32)', () => {
  it('mock swarm merges citations into research.md', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-swarm-'));
    initProject(projectRoot);
    const ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      budget: 'deep',
      phase: 'research',
      status: 'running',
      agent_pass_budget: { max_active: 2, used: 0, limit: 20 },
      next_actions: [],
    });

    const result = await runResearchSwarm(ref, {
      idea: 'research topic',
      branchCount: 2,
      parallel: true,
      runSwarm: async (branchId) => ({
        branchId,
        citation: `https://example.com/${branchId}`,
        summary: `Findings from ${branchId}`,
      }),
    });

    const research = fs.readFileSync(path.join(result.ref.runDir, 'research.md'), 'utf8');
    const provenance = fs.readFileSync(path.join(result.ref.runDir, 'swarm-provenance.md'), 'utf8');
    assert.match(research, /Swarm research merge/);
    assert.match(research, /swarm-1/);
    assert.match(provenance, /https:\/\/example\.com\/swarm-1/);
    assert.strictEqual(result.branches.length, 2);
    assert.ok(fs.existsSync(path.join(result.ref.runDir, 'swarm', 'swarm-1.md')));
  });

  it('writes per-branch artifacts under swarm/', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-swarm-art-'));
    initProject(projectRoot);
    const ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      budget: 'deep',
      phase: 'research',
      status: 'running',
      agent_pass_budget: { max_active: 2, used: 0, limit: 20 },
      next_actions: [],
    });

    await runResearchSwarm(ref, {
      idea: 'topic',
      branchCount: 2,
      runSwarm: async (branchId) => ({
        branchId,
        citation: `https://example.com/${branchId}`,
        summary: `Findings ${branchId}`,
      }),
    });

    assert.ok(fs.existsSync(path.join(ref.runDir, 'swarm', 'swarm-2.md')));
  });
});
