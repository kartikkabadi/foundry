export interface SetupFailure {
  id: string;
  message: string;
  repair?: string;
}

const MAX_AGENT_TURNS = 3;

export function buildSetupSuggestions(failures: SetupFailure[]): string[] {
  return failures.map((check) => check.repair ?? check.message);
}

/** Bounded setup-agent turn: deterministic suggestions (Composer hook point for live setup). */
export async function runSetupAgentTurn(
  failures: SetupFailure[],
  turn: number,
): Promise<string[]> {
  if (turn > MAX_AGENT_TURNS) {
    return [];
  }
  return buildSetupSuggestions(failures);
}

export { MAX_AGENT_TURNS };
