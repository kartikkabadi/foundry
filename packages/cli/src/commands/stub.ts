export function notImplemented(command: string, issue: string): never {
  console.error(`${command}: not implemented (${issue})`);
  process.exit(1);
}
