export const COVERAGE_SLOTS = [
  'User / beneficiary',
  'Current pain or job-to-be-done',
  'Desired outcome',
  'Minimum useful version',
  'Non-goals / what to delete',
  'Reference products / desired feel',
  'Constraints',
  'Quality bar / done proof',
  'Risk / unacceptable failure',
  'Autonomy / execution preference',
] as const;

export function validateIntentCoverage(content: string): void {
  for (let i = 1; i <= COVERAGE_SLOTS.length; i++) {
    const slotPattern = new RegExp(`##\\s*Slot\\s*${i}\\s*:`, 'i');
    if (!slotPattern.test(content)) {
      throw new Error(
        `intent.md missing coverage slot ${i} (${COVERAGE_SLOTS[i - 1]}). Expected heading "## Slot ${i}: ..."`,
      );
    }
  }
}
