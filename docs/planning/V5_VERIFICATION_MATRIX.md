# V5 verification matrix

Commands and scripts that must pass before closing issue #50.

| Layer | Command | Expected |
|-------|---------|----------|
| Unit | `npm test` | 0 failures |
| Integration | `bash scripts/demo.sh` | exit 0 |
| Integration | `FOUNDRY_BUILD_MOCK=1 bash scripts/demo-build.sh` | exit 0 |
| CLI harness | `bash scripts/cli-harness.sh` | exit 0 |
| CLI harness | `bash scripts/full-cli-harness.sh` | exit 0 |
| Distribution | `npm pack --dry-run` | includes `packages/cli/bin/foundry.js` |
| Global install | `npm i -g . && foundry --version` | prints version |
| Live (opt-in) | `FOUNDRY_DEMO_LIVE_PLAN=1 bash scripts/demo.sh` | live Composer plan |
| Live (opt-in) | `bash scripts/rehearsal-live.sh` | live doctor + plan |

See also `docs/planning/VERIFIED_STATE.md` and `docs/planning/LIVE_VERIFICATION.md`.
