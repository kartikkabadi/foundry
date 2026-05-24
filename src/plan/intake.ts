import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const INTAKE_QUESTIONS = [
  'Who is the primary user or beneficiary?',
  'What problem should the first version solve?',
  'What does success look like for a minimum useful version?',
] as const;

export interface IntakeResult {
  idea: string;
  answers: string[];
}

export function formatIntakeMarkdown(idea: string, answers: string[]): string {
  const lines = ['# Intake', '', `**Idea:** ${idea}`, ''];

  for (let i = 0; i < INTAKE_QUESTIONS.length; i++) {
    lines.push(`## Q${i + 1}: ${INTAKE_QUESTIONS[i]}`, '', answers[i] ?? '(no answer)', '');
  }

  return lines.join('\n');
}

export async function collectIntake(
  idea: string,
  options: { isTTY?: boolean; cannedAnswers?: string[] } = {},
): Promise<IntakeResult> {
  const isTTY = options.isTTY ?? process.stdin.isTTY;
  const canned = options.cannedAnswers;

  if (canned && canned.length >= INTAKE_QUESTIONS.length) {
    return { idea, answers: canned.slice(0, INTAKE_QUESTIONS.length) };
  }

  if (!isTTY) {
    const defaults = [
      'Developers and product teams who need structured issue breakdowns from PRDs.',
      'Manual copy-paste from markdown PRDs into GitHub issues is slow and inconsistent.',
      'A CLI that parses a PRD markdown file and creates well-structured GitHub issue drafts.',
    ];
    return { idea, answers: defaults };
  }

  const rl = readline.createInterface({ input, output });
  const answers: string[] = [];

  console.log(`\nPlanning: ${idea}\n`);
  for (const question of INTAKE_QUESTIONS) {
    const answer = await rl.question(`${question}\n> `);
    answers.push(answer.trim() || '(skipped)');
  }
  rl.close();

  return { idea, answers };
}
