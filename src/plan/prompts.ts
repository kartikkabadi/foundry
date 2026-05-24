import { ALGORITHM_PASS_ARTIFACTS } from './artifacts.js';
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

export function buildAlgorithmPassPrompt(
  idea: string,
  intakeMd: string,
  researchMd: string,
  intentMd: string,
): string {
  const artifactList = ALGORITHM_PASS_ARTIFACTS.map((name) => `---ARTIFACT: ${name}---`).join('\n');

  return `You are Foundry's Algorithm Pass agent. Apply The Algorithm operating loop:

1. Make requirements less dumb (requirements.md)
2. Delete parts/process/features that don't survive first principles (deletion-pass.md)
3. Define the minimum system that remains (minimum-system.md)
4. Simplify or optimize only what survived deletion (simplification-pass.md)
5. Accelerate the simplified process (acceleration-pass.md)
6. Automate last (automation-pass.md)

Also produce supporting artifacts: assumptions.md, decisions.md, risks.md.

Software idea: ${idea}

Intake:
${intakeMd}

Research:
${researchMd}

Intent:
${intentMd}

Output exactly nine artifacts separated by delimiter lines. Use this format:

${artifactList}

Each artifact should be substantive Markdown (not placeholders). No API keys or secrets.`;
}

export function buildSynthesisPrompt(
  idea: string,
  intakeMd: string,
  researchMd: string,
  intentMd: string,
  algorithmArtifacts: string,
): string {
  return `You are Foundry's planning synthesis agent. Produce final planning artifacts for this software idea.

Software idea: ${idea}

Intake:
${intakeMd}

Research:
${researchMd}

Intent:
${intentMd}

Algorithm Pass (requirements through risks):
${algorithmArtifacts}

Output exactly five artifacts separated by delimiter lines. Use this format:

---ARTIFACT: summary.md---
<one-page executive summary, 5-10 paragraphs>

---ARTIFACT: prd.md---
<product requirements document>

---ARTIFACT: implementation-plan.md---
<implementation plan with phases and dependencies>

---ARTIFACT: issue-plan.md---
<GitHub-ready issue breakdown; each issue uses "## Issue N: Title" with acceptance criteria and dependencies>

---ARTIFACT: build-goal.md---
<clear build goal and definition of done>

No API keys or secrets in any artifact.`;
}

export const DEFAULT_AUTONOMY_CONTRACT = `# Autonomy contract

default = "productive"

Foundry may proceed with implementation details, repo conventions, and reversible choices
within the approved plan scope. Escalate before irreversible public actions, cost spikes,
or autonomy boundary changes.

## Allowed by default
- Read local repo files
- Search public docs/GitHub/web
- Write \`.foundry\` artifacts
- Run cheap local checks

## Ask first
- Package installs
- Global config edits
- GitHub issue creation
- Commits/pushes/PRs
- Composer Fast
- Destructive operations
- Secret/private session access
`;
