/** Raised when build cannot proceed due to doctor, team comms, or conflict gates. */
export class BuildPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildPreflightError';
  }
}
