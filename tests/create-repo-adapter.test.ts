import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createPrivateGitHubRepo } from '@foundry/adapters/github-create-repo.js';

describe('create-repo adapter (#47)', () => {
  it('invokes runner when approved', async () => {
    let called = false;
    const result = await createPrivateGitHubRepo('my-app', async (name, options) => {
      called = true;
      assert.strictEqual(name, 'my-app');
      assert.strictEqual(options.private, true);
      return { name, url: 'https://github.com/org/my-app' };
    });
    assert.strictEqual(called, true);
    assert.match(result.url, /my-app/);
  });
});
