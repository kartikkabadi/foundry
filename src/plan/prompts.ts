import { COVERAGE_SLOTS } from './coverage-slots.js';

export function buildResearchPrompt(idea: string, intakeMd: string): string {
  return `You are Foundry's planning research agent. Produce concise research notes in Markdown.

Software idea: ${idea}

Intake notes:
${intakeMd}

Write research.md content covering:
- Problem space and similar tools
- Technical approaches (high level)
- Key risks and unknowns
- Recommended scope for a minimum useful version

Output Markdown only. No API keys or secrets.`;
}

export function buildInterviewPrompt(idea: string, intakeMd: string, researchMd: string): string {
  const slotList = COVERAGE_SLOTS.map((slot, i) => `${i + 1}. ${slot}`).join('\n');

  return `You are Foundry's intent interview agent. Produce intent.md in Markdown.

Software idea: ${idea}

Intake:
${intakeMd}

Research:
${researchMd}

Document ALL 10 required coverage slots using this exact heading format for each:

## Slot N: <slot name>

Required slots:
${slotList}

For each slot, write 2-4 sentences of intent-level guidance (not implementation micromanagement).
Output Markdown only. No API keys or secrets.`;
}

export function buildSynthesisPrompt(
  idea: string,
  intakeMd: string,
  researchMd: string,
  intentMd: string,
): string {
  return `You are Foundry's planning synthesis agent. Produce planning artifacts for this software idea.

Software idea: ${idea}

Intake:
${intakeMd}

Research:
${researchMd}

Intent:
${intentMd}

Output exactly six artifacts separated by delimiter lines. Use this format:

---ARTIFACT: summary.md---
<one-page executive summary>

---ARTIFACT: prd.md---
<product requirements document>

---ARTIFACT: implementation-plan.md---
<implementation plan with phases>

---ARTIFACT: issue-plan.md---
<GitHub-ready issue breakdown with acceptance criteria>

---ARTIFACT: build-goal.md---
<clear build goal and definition of done>

---ARTIFACT: algorithm-pass.md---
<hackathon waiver: single Algorithm Pass summary>

No API keys or secrets in any artifact.`;
}

export const DEFAULT_AUTONOMY_CONTRACT = `# Autonomy contract

default = "productive"

Foundry may proceed with implementation details, repo conventions, and reversible choices
within the approved plan scope. Escalate before irreversible public actions, cost spikes,
or autonomy boundary changes.
`;
