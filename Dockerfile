# Agent Deck portable image. One container serves the web client AND the BFF,
# and the BFF proxies whatever Hermes gateway you point it at. It runs against a
# STOCK hermes-agent over HTTP; it never modifies the gateway.
#
# Build:  docker build -t agent-deck:local .
# Run:    docker run --rm -p 127.0.0.1:7878:7878 \
#           -e HERMES_GATEWAY_URL=http://host.docker.internal:8642 \
#           --add-host host.docker.internal:host-gateway agent-deck:local
# Then open http://127.0.0.1:7878
#
# The server is run through tsx because the protocol package is consumed as
# TypeScript source (its package exports point at src), which is the same way
# the non-container deploy runs it.

# --- build: install the workspace and produce the web bundle ---------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Install with the lockfile first (cached unless a manifest changes).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Bring in the source and build the web client (vite -> apps/web/dist).
COPY . .
RUN pnpm --filter @agent-deck/web build

# --- runtime: serve the bundle + proxy the gateway -------------------------
# Reuses the build layer (it already holds the workspace + tsx + the built
# bundle); a returning operator gets one self-contained process.
FROM build AS runtime
ENV NODE_ENV=production \
    TMPDIR=/tmp \
    AGENT_DECK_HOST=0.0.0.0 \
    AGENT_DECK_UNSAFE_BIND=1 \
    AGENT_DECK_PORT=7878 \
    AGENT_DECK_WEB_CLIENT_ROOT=/app/apps/web/dist \
    HERMES_GATEWAY_URL=http://host.docker.internal:8642
# AGENT_DECK_HOST=0.0.0.0 binds every interface INSIDE the container (the
# container network is the boundary, and the published port is what you choose
# to expose), so the otherwise-required wildcard opt-in is set here on purpose.
# Binding a non-loopback host puts the deck in remote mode: the interactive
# terminal stays OFF unless you set AGENT_DECK_ENABLE_TERMINAL=1, and you should
# set AGENT_DECK_TOKEN when the published port is reachable by anyone but you.

# Drop to the unprivileged user the base image already ships.
USER node

EXPOSE 7878
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_DECK_PORT||7878)+'/api/agent-deck/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@agent-deck/server", "exec", "tsx", "src/index.ts"]
