import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { IssueDraft, PublishDeps, PublishResult } from '../types/publish.js';
import { formatLocalIssueMarkdown, parseIssuePlan } from './issue-plan.js';
import { scrubSecrets } from '../config/secrets.js';

function execGh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? '').trim(),
      stderr: String(e.stderr ?? e.message ?? '').trim(),
    };
  }
}

export function createDefaultPublishDeps(overrides: Partial<PublishDeps> = {}): PublishDeps {
  return {
    execGh,
    async confirm(prompt: string) {
      if (!process.stdin.isTTY) {
        return false;
      }
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(`${prompt} [y/N] `);
        return answer.trim().toLowerCase() === 'y';
      } finally {
        rl.close();
      }
    },
    writeFile(path, content) {
      writeFileSync(path, scrubSecrets(content), 'utf8');
    },
    mkdir(path) {
      mkdirSync(path, { recursive: true });
    },
    ...overrides,
  };
}

function ghAvailable(deps: PublishDeps): boolean {
  const status = deps.execGh(['auth', 'status']);
  return status.ok;
}

async function createGithubIssue(
  deps: PublishDeps,
  draft: IssueDraft,
  dryRun: boolean,
): Promise<{ url?: string; skipped?: string }> {
  if (dryRun) {
    return { skipped: draft.title };
  }

  const approved = await deps.confirm(
    `Create GitHub issue #${draft.number}: "${draft.title}"?`,
  );
  if (!approved) {
    return { skipped: draft.title };
  }

  const bodyFile = join(process.cwd(), '.foundry', '.publish-body.tmp');
  deps.writeFile(bodyFile, draft.body);

  const result = deps.execGh([
    'issue',
    'create',
    '--title',
    draft.title,
    '--body-file',
    bodyFile,
  ]);

  if (!result.ok) {
    throw new Error(`gh issue create failed for "${draft.title}": ${result.stderr}`);
  }

  const url = result.stdout.split('\n').pop()?.trim();
  return { url: url || undefined };
}

export async function publishIssuePlan(options: {
  issuePlanPath: string;
  runDir: string;
  approve: boolean;
  deps?: Partial<PublishDeps>;
}): Promise<PublishResult> {
  const deps = createDefaultPublishDeps(options.deps);
  const raw = scrubSecrets(readFileSync(options.issuePlanPath, 'utf8'));
  const drafts = parseIssuePlan(raw);
  const outputDir = join(options.runDir, 'issues');
  deps.mkdir(outputDir);

  const result: PublishResult = {
    created: [],
    localFallback: [],
    skipped: [],
    outputDir,
  };

  const useGithub = options.approve && ghAvailable(deps);

  for (const draft of drafts) {
    const localPath = join(outputDir, `issue-${String(draft.number).padStart(2, '0')}.md`);
    const localContent = formatLocalIssueMarkdown(draft);
    deps.writeFile(localPath, localContent);
    result.localFallback.push(localPath);

    if (!useGithub) {
      continue;
    }

    try {
      const created = await createGithubIssue(deps, draft, false);
      if (created.url) {
        result.created.push({ number: draft.number, title: draft.title, url: created.url });
      } else if (created.skipped) {
        result.skipped.push(created.skipped);
      }
    } catch {
      result.skipped.push(draft.title);
    }
  }

  const manifestPath = join(outputDir, 'publish-manifest.json');
  deps.writeFile(
    manifestPath,
    JSON.stringify(
      {
        created: result.created,
        localFallback: result.localFallback.map((p) => p.split('/').pop()),
        skipped: result.skipped,
        githubAttempted: useGithub,
      },
      null,
      2,
    ),
  );

  return result;
}

export function findLatestRunIssuePlan(projectRoot: string): { runDir: string; path: string } | null {
  const runsDir = join(projectRoot, '.foundry', 'runs');
  if (!existsSync(runsDir)) {
    return null;
  }

  const runs = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const runId of runs) {
    const runDir = join(runsDir, runId);
    const issuePlan = join(runDir, 'issue-plan.md');
    if (existsSync(issuePlan)) {
      return { runDir, path: issuePlan };
    }
  }

  return null;
}
