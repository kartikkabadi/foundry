# Foundry

Human-in-the-loop software factory. Next.js 16.3.1 + eve. GLM 5.2 workers. Dashboard is the operator surface.

Spec: [issue #1](https://github.com/kartikkabadi/foundry/issues/1). Language: [CONTEXT.md](./CONTEXT.md).

## Run

Node 24. Tailscale to this VPS. No extra login.

```sh
sfw npm install
npm run dev
```

Open `http://vps.tailb387b4.ts.net:3100/` (or localhost:3100 on this VPS).

Data lives in `data/` (gitignored). Opening an Issue runs research through the eve worker and writes a brief to disk. Docker sandboxes are not in this slice yet. Grill is the next gate and is not built yet.

## v1 lock

See issue #1. Do not reopen those decisions in a PR; file a Decision ticket.
