import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadTeamSpecFromFile,
  parseTeamSpecSource,
  TeamSpecValidationError,
  teamSpecToConfigSection,
} from '@foundry/core/team/spec.js';
import { initProject } from '@foundry/core/state/run-writer.js';

const root = path.join(import.meta.dirname, '..');

describe('team spec (#33)', () => {
  it('rejects invalid team pack with line-level validation errors', () => {
    const invalid = path.join(root, 'fixtures/team-pack-invalid.toml');
    assert.throws(
      () => loadTeamSpecFromFile(invalid),
      (err: unknown) => {
        assert.ok(err instanceof TeamSpecValidationError);
        assert.ok(err.issues.some((i) => i.includes('id')));
        return true;
      },
    );
  });

  it('parses valid team pack', () => {
    const valid = path.join(root, 'fixtures/team-pack-valid.toml');
    const spec = loadTeamSpecFromFile(valid);
    assert.strictEqual(spec.name, 'fixture-team');
    assert.strictEqual(spec.roles.length, 2);
    assert.strictEqual(spec.roles[0]?.id, 'researcher');
  });

  it('init --team stores team section in config.toml', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-team-'));
    const valid = path.join(root, 'fixtures/team-pack-valid.toml');
    const result = initProject(projectRoot, { teamPackPath: valid });
    const config = fs.readFileSync(result.configPath, 'utf8');
    assert.ok(config.includes('[team]'));
    assert.ok(config.includes('researcher'));
    assert.ok(result.teamLoaded);
  });

  it('teamSpecToConfigSection round-trips structure', () => {
    const spec = parseTeamSpecSource(
      fs.readFileSync(path.join(root, 'fixtures/team-pack-valid.toml'), 'utf8'),
    );
    const section = teamSpecToConfigSection(spec);
    assert.match(section, /\[team\]/);
    assert.match(section, /\[\[team\.roles\]\]/);
  });
});
