import type { RunJson } from '@foundry/core/types/run.js';

export function renderRunPanels(run: RunJson): string {
  const budgetLine = `Budget: ${run.budget} | Passes: ${run.agent_pass_budget.used}/${run.agent_pass_budget.limit}`;
  const lines = [
    '┌─ Foundry TUI ─────────────────────',
    `│ Run ${run.run_id}`,
    `│ Mode: ${run.mode}  Status: ${run.status}`,
    `│ Phase: ${run.phase}`,
    `│ ${budgetLine}`,
    '│ Approval: ' +
      (run.status === 'awaiting_approval'
        ? 'WAITING'
        : run.status === 'approved'
          ? 'APPROVED'
          : run.status),
    '└───────────────────────────────────',
  ];
  return lines.join('\n');
}
