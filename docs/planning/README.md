# Foundry Planning Snapshot

Created: 2026-05-24
Last updated: 2026-05-24

This folder captures the locked planning decisions for Foundry so the design does not get lost while the product is still being grilled.

Files:

- `DECISIONS.md` - locked decisions so far.
- `RUNNING_SPEC.md` - the current product shape in one coherent spec.
- `V1_PLAN.md` - concise v1 scope, architecture, milestones, and verification plan.
- `GITHUB_ISSUE_BREAKDOWN.md` - Matt Pocock-style vertical-slice issue draft for GitHub.
- `PUBLISHED_ISSUES.md` - published GitHub issue URLs for the v1 slices.
- `OPEN_QUESTIONS.md` - next planning branches to resolve.
- `VERIFIED_STATE.md` - issue → code → test → status (#1–#50).

Status:

- **Implementation on `main`:** V1–V3 shipped (#1–#30 closed); V4–V5 open (#31–#50). This folder is the planning SSOT alongside code-verified [VERIFIED_STATE.md](VERIFIED_STATE.md).
- **First milestone achieved (alignment + docs)**: Clear separation documented + hygiene baseline started. See new "## Repo Alignment (2026-05, after user clarification)" section in DECISIONS.md.
- **Pi Extension Pack (powerpack)** = pure guide-style + curated assets / whole Git repo (agent-feedable: "feed this repo to your agent..."). Local clone at documents/Projects/pi-composer-powerpack. Not a "run this script" — copy-paste guide + assets for polished Pi + Composer 2.5 + multi-agent.
- **Foundry (this repo)** = rock-solid, detailed, actual multi-agent planning/build runtime (V1 spec: doctor/setup/plan/build, Composer 2.5 exclusive, artifacts, autonomy). Local clone at documents/Projects/foundry.
- Local clones healthy and preflighted (git discipline followed). Powerpack direction revived strictly as the guide layer per user clarification (both repos kept active + cross-linked).
- Latest checkpoint includes the Composer-only model policy, autonomy action taxonomy, run/resume mechanics, comms/conflict artifacts, and question-quality policy.
- Powerpack README now includes explicit agent-walkthrough instructions (per user: agent asks the 10 coverage questions, walks setup). Both READMEs + this planning updated with roles and links.
