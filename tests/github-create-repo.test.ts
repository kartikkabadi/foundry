import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseGhRepoCreateUrl,
} from '@foundry/adapters/github-create-repo.js';

describe('github-create-repo (#47)', () => {
  it('parseGhRepoCreateUrl reads URL from gh stdout', () => {
    const stdout = 'https://github.com/acme-corp/my-app\n';
    assert.strictEqual(parseGhRepoCreateUrl(stdout), 'https://github.com/acme-corp/my-app');
  });

  it('parseGhRepoCreateUrl rejects output without a GitHub URL', () => {
    assert.throws(() => parseGhRepoCreateUrl('created repo\n'), /did not return a repository URL/);
  });
});
