import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Documents required verification commands per master plan Part E. */
export const V5_VERIFICATION_COMMANDS = [
  { layer: 'unit', command: 'npm test', expected: '0 fail' },
  { layer: 'integration-plan', command: 'bash scripts/demo.sh', expected: 'exit 0' },
  {
    layer: 'integration-build',
    command: 'FOUNDRY_BUILD_MOCK=1 bash scripts/demo-build.sh',
    expected: 'exit 0',
  },
  { layer: 'boundary', command: 'npm test -- package-boundaries', expected: 'pass' },
] as const;

describe('v5 verification matrix (#50)', () => {
  it('documents required commands from master plan', () => {
    assert.ok(V5_VERIFICATION_COMMANDS.length >= 4);
    assert.ok(V5_VERIFICATION_COMMANDS.some((c) => c.command.includes('npm test')));
    assert.ok(V5_VERIFICATION_COMMANDS.some((c) => c.command.includes('demo-build.sh')));
  });

  it('CI workflow includes test and demo scripts', () => {
    const ci = readFileSync(
      path.join(import.meta.dirname, '../.github/workflows/ci.yml'),
      'utf8',
    );
    assert.match(ci, /npm test/);
    assert.match(ci, /demo\.sh/);
    assert.match(ci, /demo-build/);
  });

  it('CONTEXT.md exists for glossary hardening', () => {
    const context = readFileSync(path.join(import.meta.dirname, '../CONTEXT.md'), 'utf8');
    assert.match(context, /Doctor/);
    assert.match(context, /Run/);
  });
});
