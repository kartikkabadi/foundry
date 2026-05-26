import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSetupArgs } from '../packages/cli/src/commands/setup.js';
import { MAX_AGENT_TURNS, runSetupAgentTurn } from '@foundry/planner/setup/suggestions.js';

describe('setup agent (#46)', () => {
  it('expert mode skips agent loop flag path', () => {
    assert.strictEqual(parseSetupArgs(['--expert']), 'expert');
  });

  it('recommended mode is default', () => {
    assert.strictEqual(parseSetupArgs([]), 'recommended');
  });

  it('runSetupAgentTurn returns bounded suggestions', async () => {
    const suggestions = await runSetupAgentTurn(
      [{ id: 'pi-cli', message: 'missing', repair: 'install pi' }],
      1,
    );
    assert.ok(suggestions.length >= 1);
    const capped = await runSetupAgentTurn(
      [{ id: 'pi-cli', message: 'missing', repair: 'install pi' }],
      MAX_AGENT_TURNS + 1,
    );
    assert.strictEqual(capped.length, 0);
  });

  it('bounded agent loop env is documented in setup source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(import.meta.dirname, '../packages/cli/src/commands/setup.ts'),
      'utf8',
    );
    assert.match(src, /FOUNDRY_SETUP_AGENT/);
    assert.match(src, /MAX_SETUP_ROUNDS/);
  });
});
