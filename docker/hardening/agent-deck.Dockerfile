# Hardening harness — build Agent Deck from the copied working tree via its REAL
# local install path, so the container tests exactly what a newcomer's
# `pnpm install && pnpm build && pnpm start` does on a clean machine.
#
# NOT install.sh, which clones github.com/victorv2i/agent-deck (unpublished);
# see finding about the install.sh repo dependency. This Dockerfile is the local path.
FROM node:22-bookworm-slim

# Just git (postinstall) + curl (healthchecks) — NO python3/make/g++ build toolchain.
# This is the PROOF for finding F3: `node-pty` is now an optionalDependency, so its
# native build failing on a toolchain-less machine is non-fatal — `pnpm install`
# survives and the terminal degrades honestly ("terminal unavailable") at runtime.
# A bare node base must install+build+run the deck with NO compiler present.
RUN apt-get update && apt-get install -y --no-install-recommends \
  git curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, pinned by the repo's packageManager field.
RUN corepack enable

WORKDIR /app
COPY . .
# Defensive: drop any host-built artifacts that slipped past .dockerignore so the
# install is genuinely fresh (host node_modules can carry platform-specific binaries).
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/web/dist apps/server/dist 2>/dev/null || true

# The real newcomer install path.
RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 7878
# `pnpm start` rebuilds then serves; use start:server since build already ran above.
CMD ["pnpm", "start:server"]
