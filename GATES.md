# Gates: Foundry v1 scaffold

Scope: Public repo, PRD issue, Next 16.3.1 + eve app, Issue store, node-graph Issue home, Tailscale-ready dashboard.

- [x] G1: GitHub repo kartikkabadi/foundry exists and is public
  CHECK: gh repo view kartikkabadi/foundry --json name,isPrivate,url -q '.name + " " + (.isPrivate|tostring) + " " + .url'
  EXPECT: foundry false https://github.com/kartikkabadi/foundry
  EVIDENCE: foundry false https://github.com/kartikkabadi/foundry

- [x] G2: PRD is GitHub issue #1
  CHECK: gh issue view 1 --json title,url -q '.title + " " + .url'
  EXPECT: PRD: Foundry
  EVIDENCE: PRD: Foundry human-in-the-loop software factory https://github.com/kartikkabadi/foundry/issues/1

- [x] G3: next is 16.3.1 not a preview
  CHECK: node -p "require('./package.json').dependencies.next"
  EXPECT: 16.3.1
  EVIDENCE: 16.3.1

- [x] G4: typecheck passes
  CHECK: npm run typecheck
  EXPECT: 
  EVIDENCE: tsc --noEmit exited 0

- [x] G5: Issue store creates a forced-L Issue with council and architecture not skipped
  CHECK: npx tsx scripts/check-walk.ts
  EXPECT: WALK_OK
  EVIDENCE: WALK_OK 6e884f5b-6229-4df9-ad57-1dc98dbf1fbe research

