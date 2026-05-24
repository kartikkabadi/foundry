export function printHelp(version: string): void {
  console.log(`foundry v${version}

Usage: foundry <command> [options]

Commands (v1):
  init       Initialize .foundry/ in the current repo
  doctor     Run capability checks
  setup      Agent-guided setup (--recommended|--expert)
  plan       Create planning artifacts
  publish    Convert issue-plan.md to drafts (GitHub with --approve)
  status     Show current run status
  pause      Pause an active run
  resume     Resume a paused run
  approve    Approve plan for build
  build      Execute approved build (preflight)

Options:
  --version, -v   Print version
  --help, -h      Show this help

See docs for details.`);
}
