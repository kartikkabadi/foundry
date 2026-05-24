# Foundry troubleshooting

## Node version

Use **Node 20 LTS** (see `.nvmrc`):

```bash
fnm use   # or nvm use
npm run build
npm rebuild sqlite3   # if @cursor/sdk fails to load
```

## Cursor API key

Resolution order:

1. `export CURSOR_API_KEY=...`
2. Pi stored key: `~/.pi/agent/auth.json` → `cursor` provider

Verify (never prints the key):

```bash
foundry doctor --for plan
foundry doctor --for plan --deep   # live Composer smoke (~60s)
```

## sqlite3 / @cursor/sdk

If doctor reports bindings errors:

```bash
npm run postinstall
# or
cd node_modules/sqlite3 && npm run install
```

## Pi CLI

Install Pi separately. Foundry requires `pi` on PATH for the hackathon demo matrix.

## GitHub publish

```bash
foundry publish              # local markdown drafts only
foundry publish --approve    # prompts before each gh issue create
```

Requires `gh auth login` for GitHub creation.

## Project layout

```bash
foundry init                 # creates .foundry/config.toml
foundry doctor --fix         # repairs Foundry-owned state only
```
