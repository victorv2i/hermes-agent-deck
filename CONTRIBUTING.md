# Contributing to Agentdeck

Thanks for your interest. Agentdeck is a local-first web UI for the
[NousResearch Hermes](https://github.com/NousResearch/hermes-agent) agent.
Issues and PRs are welcome.

## Development

A pnpm monorepo. **Prerequisites:** Node.js >= 20, pnpm 10.

```bash
pnpm install                    # install workspace dependencies
npx playwright install chromium # one-time: the e2e step in `pnpm verify` drives a real browser
pnpm dev                        # Fastify on :7878 + Vite on :5173, hot reload
pnpm verify                     # the full gate (run before every PR)
```

`pnpm dev` runs two hot-reloading processes: Vite (`:5173`) proxies `/api` and
`/socket.io` to Fastify (`:7878`). Use it while developing the UI. `pnpm start`
runs the single built process for a local run, and `pnpm demo` previews the UI
against a fake gateway with no Hermes backend (see the README).

## The gate

Every PR must pass `pnpm verify`, the same gate CI runs:

```
format → lint → typecheck → test → build → e2e
```

Keep it GREEN. If a check can't run in your environment, say so in the PR and
note what still needs to run.

## How we like changes

- **Surgical.** Touch only the files and lines the change needs. Don't refactor
  adjacent code, rename things, or reformat files that your change didn't
  require.
- **Match the existing style** even if you'd design it differently. Prettier and
  ESLint are the source of truth: run `pnpm format` before committing.
- **Tests track behavior.** Add or update tests with the code they cover, and
  clean up anything your change made stale.
- **Boring over clever.** Prefer the smallest clear, readable solution. No
  speculative features or single-use abstractions.

Every changed line should trace to the issue or feature it serves.

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
