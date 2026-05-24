import type { IssuePlanNode, ProofType } from '@foundry/core/types/build.js';
import { parseIssuePlan } from '../publish/issue-plan.js';

const TYPE_LINE = /^Type:\s*(code|ui|docs|config|research)\s*$/im;
const BLOCKED_LINE = /^(?:Blocked by|Depends on):\s*(.+)$/im;

function parseBlockedBy(line: string): number[] {
  const matches = [...line.matchAll(/#(\d+)/g)];
  return matches.map((match) => Number.parseInt(match[1]!, 10));
}

function parseIssueType(body: string): ProofType {
  const match = body.match(TYPE_LINE);
  if (!match?.[1]) {
    return 'code';
  }
  return match[1] as ProofType;
}

function parseBlockedDeps(body: string): number[] {
  const match = body.match(BLOCKED_LINE);
  if (!match?.[1]) {
    return [];
  }
  return parseBlockedBy(match[1]);
}

export function parseIssuePlanGraph(markdown: string): IssuePlanNode[] {
  const drafts = parseIssuePlan(markdown);
  return drafts.map((draft) => ({
    number: draft.number,
    title: draft.title,
    type: parseIssueType(draft.body),
    blocked_by: parseBlockedDeps(draft.body),
    body: draft.body,
  }));
}

export class IssuePlanGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssuePlanGraphError';
  }
}

export function topologicalOrder(nodes: IssuePlanNode[]): IssuePlanNode[] {
  const byNumber = new Map(nodes.map((node) => [node.number, node]));
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const ordered: IssuePlanNode[] = [];

  function visit(number: number): void {
    if (visited.has(number)) {
      return;
    }
    if (visiting.has(number)) {
      throw new IssuePlanGraphError(`Cycle detected involving issue #${number}`);
    }

    const node = byNumber.get(number);
    if (!node) {
      throw new IssuePlanGraphError(`Missing dependency issue #${number}`);
    }

    visiting.add(number);
    for (const dep of node.blocked_by) {
      if (!byNumber.has(dep)) {
        throw new IssuePlanGraphError(`Issue #${number} depends on missing issue #${dep}`);
      }
      visit(dep);
    }
    visiting.delete(number);
    visited.add(number);
    ordered.push(node);
  }

  for (const node of [...nodes].sort((a, b) => a.number - b.number)) {
    visit(node.number);
  }

  return ordered;
}

export function formatExecutionOrder(nodes: IssuePlanNode[]): string {
  const ordered = topologicalOrder(nodes);
  return ordered.map((node) => `#${node.number}: ${node.title} (${node.type})`).join('\n');
}
