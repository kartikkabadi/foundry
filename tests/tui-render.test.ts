import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRunJson } from '@foundry/core/schema/run-json.js';
import { renderRunPanels } from '../packages/cli/src/tui/render.js';

describe('TUI render (#41)', () => {
  it('fixture run.json renders expected panels', () => {
    const fixturePath = path.join(import.meta.dirname, '../fixtures/example-run/run.json');
    const run = parseRunJson(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const rendered = renderRunPanels(run);
    assert.match(rendered, /Foundry TUI/);
    assert.match(rendered, new RegExp(run.run_id));
    assert.match(rendered, /deep/);
  });
});
