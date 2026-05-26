export function printHelp(version: string): void {
  console.log(`foundry v${version}

Usage: foundry <command> [options]

Commands:
  init       Initialize .foundry/ in the current repo
  doctor     Run capability checks (--for plan|setup|build|all, --deep, --json, --fix)
  setup      Agent-guided setup (--recommended|--expert)
  plan       Create planning artifacts (--budget, --reference, --swarm research)
  publish    Convert issue-plan.md to drafts (GitHub with --approve)
  status     Show current run status
  pause      Pause an active run
  resume     Resume a paused run [run-id]
  approve    Approve plan for build
  build      Execute approved build (--dry-run, --parallel N)
  tui        Print run status panel
  daemon     start|stop|status (PID file)
  notify     --dry-run webhook payload validation
  update     --dry-run self-update metadata

Options:
  --version, -v   Print version
  --help, -h      Show this help

See docs for details.`);
}
