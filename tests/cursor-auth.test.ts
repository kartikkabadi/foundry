import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getDefaultPiAuthPath,
  readPiCursorApiKey,
  resolveCursorApiKey,
} from '@foundry/core/config/cursor-auth.js';
import { parseIssuePlan, formatLocalIssueMarkdown } from '@foundry/planner/publish/issue-plan.js';
import { publishIssuePlan } from '@foundry/planner/publish/orchestrate.js';

describe('cursor-auth resolver', () => {
  it('prefers CURSOR_API_KEY env over Pi auth', () => {
    const tmpAuth = path.join(os.tmpdir(), `foundry-auth-${Date.now()}.json`);
    fs.writeFileSync(
      tmpAuth,
      JSON.stringify({ cursor: { type: 'api_key', key: 'pi-key-should-not-win' } }),
      'utf8',
    );

    const resolution = resolveCursorApiKey({
      env: { CURSOR_API_KEY: 'env-key' },
      piAuthPath: tmpAuth,
    });

    assert.strictEqual(resolution.source, 'env');
    assert.strictEqual(resolution.apiKey, 'env-key');
    fs.unlinkSync(tmpAuth);
  });

  it('falls back to Pi auth.json cursor key', () => {
    const tmpAuth = path.join(os.tmpdir(), `foundry-auth-${Date.now()}.json`);
    fs.writeFileSync(
      tmpAuth,
      JSON.stringify({ cursor: { type: 'api_key', key: 'pi-resolved-key' } }),
      'utf8',
    );

    const resolution = resolveCursorApiKey({ env: {}, piAuthPath: tmpAuth });
    assert.strictEqual(resolution.source, 'pi-auth');
    assert.strictEqual(resolution.apiKey, 'pi-resolved-key');
    assert.strictEqual(readPiCursorApiKey(tmpAuth), 'pi-resolved-key');
    fs.unlinkSync(tmpAuth);
  });

  it('returns none when unset', () => {
    const resolution = resolveCursorApiKey({
      env: {},
      piAuthPath: path.join(os.tmpdir(), 'missing-auth.json'),
    });
    assert.strictEqual(resolution.source, 'none');
    assert.strictEqual(resolution.apiKey, undefined);
  });

  it('getDefaultPiAuthPath points at Pi agent auth.json', () => {
    assert.ok(getDefaultPiAuthPath().endsWith(path.join('.pi', 'agent', 'auth.json')));
  });
});

describe('publish issue-plan', () => {
  it('parses ## Issue N: headings into drafts', () => {
    const markdown = `## Issue 1: Bootstrap CLI

Acceptance criteria here.

## Issue 2: Doctor checks

More details.`;

    const drafts = parseIssuePlan(markdown);
    assert.strictEqual(drafts.length, 2);
    assert.strictEqual(drafts[0]!.title, 'Bootstrap CLI');
    assert.match(drafts[0]!.body, /Acceptance criteria/);
    assert.strictEqual(drafts[1]!.number, 2);
  });

  it('writes local markdown fallback without gh', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-publish-'));
    const issuePlanPath = path.join(runDir, 'issue-plan.md');
    fs.writeFileSync(
      issuePlanPath,
      '## Issue 1: First issue\n\nBody one.\n\n## Issue 2: Second issue\n\nBody two.\n',
      'utf8',
    );

    const written: string[] = [];
    const result = await publishIssuePlan({
      issuePlanPath,
      runDir,
      approve: false,
      deps: {
        execGh() {
          return { ok: false, stdout: '', stderr: 'not available' };
        },
        async confirm() {
          return false;
        },
        writeFile(filePath, content) {
          fs.writeFileSync(filePath, content, 'utf8');
          written.push(filePath);
        },
        mkdir(dir) {
          fs.mkdirSync(dir, { recursive: true });
        },
      },
    });

    assert.strictEqual(result.created.length, 0);
    assert.strictEqual(result.localFallback.length, 2);
    assert.ok(written.some((p) => p.endsWith('issue-01.md')));
    assert.ok(fs.existsSync(path.join(runDir, 'issues', 'publish-manifest.json')));

    const localMd = formatLocalIssueMarkdown(parseIssuePlan(fs.readFileSync(issuePlanPath, 'utf8'))[0]!);
    assert.match(localMd, /First issue/);

    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
