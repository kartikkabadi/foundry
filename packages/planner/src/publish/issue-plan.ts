import type { IssueDraft, PublishResult } from '@foundry/core/types/publish.js';
import { scrubSecrets } from '@foundry/core/config/secrets.js';

const ISSUE_HEADING = /^##\s+(?:Issue\s+)?(\d+)[:\.]?\s*(.+)$/gm;

export function parseIssuePlan(markdown: string): IssueDraft[] {
  const cleaned = scrubSecrets(markdown);
  const matches = [...cleaned.matchAll(ISSUE_HEADING)];

  if (matches.length === 0) {
    throw new Error('issue-plan.md has no ## Issue N: headings');
  }

  const drafts: IssueDraft[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const next = matches[i + 1];
    const start = match.index ?? 0;
    const end = next?.index ?? cleaned.length;
    const block = cleaned.slice(start, end).trim();
    const title = match[2]?.trim() ?? `Issue ${match[1]}`;
    const body = block.replace(/^##\s+.+\n?/, '').trim();

    drafts.push({
      number: Number.parseInt(match[1]!, 10),
      title,
      body: body || `# ${title}\n\n(See issue-plan.md)`,
    });
  }

  return drafts.sort((a, b) => a.number - b.number);
}

export function formatLocalIssueMarkdown(draft: IssueDraft): string {
  return `# ${draft.title}

${draft.body.trim()}
`;
}

export function summarizePublishResult(result: PublishResult): string {
  const lines = [`Published ${result.created.length} issue(s).`];
  if (result.localFallback.length > 0) {
    lines.push(`Local fallback: ${result.localFallback.length} draft(s) in ${result.outputDir}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`Skipped: ${result.skipped.join(', ')}`);
  }
  return lines.join('\n');
}
