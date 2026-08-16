# Foundry

Human-in-the-loop software factory. Next.js 16.3.1 + eve. GLM 5.2 workers. Dashboard is the operator surface.

Spec: [issue #1](https://github.com/kartikkabadi/foundry/issues/1). Language: [CONTEXT.md](./CONTEXT.md).

## Run

Node 24. Tailscale to this VPS. No extra login.

```sh
sfw npm install
npm run dev
```

Open the printed localhost URL (or the Tailscale hostname on port 3000).

Data lives in `data/` (gitignored). Docker sandboxes are not in this first slice yet.

## v1 lock

See issue #1. Do not reopen those decisions in a PR; file a Decision ticket.
