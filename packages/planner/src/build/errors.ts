export class BuildPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildPreflightError';
  }
}
