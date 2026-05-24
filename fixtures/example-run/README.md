# Example plan run (fixture)

This directory documents the expected artifacts from a successful `foundry plan` run per [V1_PLAN.md](../docs/planning/V1_PLAN.md).

**Canned demo idea:** "CLI that converts markdown PRDs to GitHub issues"

## Expected layout

```text
.foundry/runs/<run-id>/
  run.json
  status.md
  intake.md
  research.md
  intent.md
  requirements.md
  deletion-pass.md
  minimum-system.md
  simplification-pass.md
  acceleration-pass.md
  automation-pass.md
  assumptions.md
  decisions.md
  risks.md
  summary.md
  prd.md
  implementation-plan.md
  issue-plan.md
  build-goal.md
  autonomy-contract.md
```

## Generate locally

```bash
foundry init
foundry doctor --for plan --deep
foundry plan "CLI that converts markdown PRDs to GitHub issues"
```

## CI fixture (no live Composer)

```bash
npm run build
npx tsx scripts/fixture-plan-smoke.ts /tmp/foundry-fixture-project
```

Status after plan: `awaiting_approval` — build and publish are blocked until user approves.
