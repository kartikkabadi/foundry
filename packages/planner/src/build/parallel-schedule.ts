import type { IssuePlanNode } from '@foundry/core/types/build.js';
import { topologicalOrder } from './issue-plan-graph.js';

const PATHS_LINE = /^Paths:\s*(.+)$/im;

export interface ComputeBuildWavesOptions {
  maxParallel?: number;
  /** Issue numbers already completed (excluded from scheduling). */
  completed?: Set<number>;
}

/** Conservative path set for overlap detection; missing Paths: => whole repo (serial). */
export function issuePathKeys(node: IssuePlanNode): string[] {
  const match = node.body.match(PATHS_LINE);
  if (!match?.[1]) {
    return ['**'];
  }
  return match[1]
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function pathsOverlap(a: string[], b: string[]): boolean {
  if (a.includes('**') || b.includes('**')) {
    return true;
  }
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb || pa.startsWith(pb) || pb.startsWith(pa)) {
        return true;
      }
    }
  }
  return false;
}

function depsComplete(node: IssuePlanNode, completed: Set<number>): boolean {
  return node.blocked_by.every((dep) => completed.has(dep));
}

/**
 * Greedy wave schedule: topological order, pack independent issues per wave.
 * Issues without satisfied blocked_by are skipped until deps appear in completed.
 */
export function computeBuildWaves(
  nodes: IssuePlanNode[],
  opts: ComputeBuildWavesOptions = {},
): number[][] {
  const maxParallel = opts.maxParallel ?? 3;
  const completed = new Set(opts.completed ?? []);
  const ordered = topologicalOrder(nodes);
  const remaining = new Set(
    ordered.map((n) => n.number).filter((num) => !completed.has(num)),
  );
  const pathByNumber = new Map(ordered.map((n) => [n.number, issuePathKeys(n)]));
  const waves: number[][] = [];

  while (remaining.size > 0) {
    const wave: number[] = [];
    const wavePaths: string[][] = [];

    for (const node of ordered) {
      if (!remaining.has(node.number)) {
        continue;
      }
      if (!depsComplete(node, completed)) {
        continue;
      }
      const paths = pathByNumber.get(node.number) ?? ['**'];
      if (wavePaths.some((wp) => pathsOverlap(paths, wp))) {
        continue;
      }
      if (wave.length >= maxParallel) {
        continue;
      }
      wave.push(node.number);
      wavePaths.push(paths);
    }

    if (wave.length === 0) {
      throw new Error(
        `Cannot schedule remaining issues: ${[...remaining].join(', ')} (blocked or path conflict)`,
      );
    }

    waves.push(wave);
    for (const num of wave) {
      remaining.delete(num);
      completed.add(num);
    }
  }

  return waves;
}
