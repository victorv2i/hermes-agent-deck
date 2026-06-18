# Running Agentdeck in Docker

Agentdeck is a web UI for a Hermes agent. The container serves the web client
and the small backend in one process, and the backend talks to your Hermes
gateway over HTTP. It runs against a stock hermes-agent and never modifies it.

## Quick start

You need a Hermes gateway running on your host (`hermes gateway`) and Docker.

```sh
docker compose up --build
```

Then open http://127.0.0.1:7878.

Compose publishes the port on loopback only, so by default just this machine can
reach it. It points the deck at `http://host.docker.internal:8642` (the stock
Hermes gateway port on your host). If you relocated the gateway, set the port:

```sh
HERMES_GATEWAY_URL=http://host.docker.internal:9000 docker compose up --build
```

Without Compose:

```sh
docker build -t agent-deck:local .
docker run --rm -p 127.0.0.1:7878:7878 \
  -e HERMES_GATEWAY_URL=http://host.docker.internal:8642 \
  --add-host host.docker.internal:host-gateway \
  agent-deck:local
```

## Signing in

The container binds a non-loopback host, so it always requires an access token
(a deck that anyone on the network could reach without one would be unsafe). You
have two choices:

- Pin your own: set `AGENT_DECK_TOKEN` to a long random string. Recommended for
  containers, because the token then stays the same every time you recreate the
  container.
- Use the auto-generated one: if you do not set `AGENT_DECK_TOKEN`, the deck
  generates a token on first start and prints it to the logs. Read it with
  `docker compose logs` (or `docker logs <container>`); look for the
  `access token:` line.

Open the deck and enter the token in the unlock screen. The token is never
injected into the page, only checked against what you type.

## What works in the container

Everything the deck reads from the Hermes gateway over HTTP works the same as a
local install:

- Chat with your agent (streaming replies, tool calls, approvals)
- Sessions list and history, the "while you were away" digest
- Usage and cost (with honest subscription / metered / local labeling)
- Scheduled jobs (the cron cockpit) and the kanban board
- MCP servers, connections, and config you can read

## What needs the Hermes CLI on the host

A few actions shell out to the `hermes` command rather than the HTTP gateway, so
they are not available from inside a plain container (which has no `hermes`
binary and no access to your host shell):

- Creating, cloning, renaming, deleting, exporting, or importing agents
- The interactive terminal (in the container it would open a shell inside the
  container, not on your host), so it is OFF by default in container mode

These degrade honestly: the affected buttons report that the action could not be
completed rather than pretending it worked. If you need them, run the deck
directly on the host instead of in a container, or mount the `hermes` binary and
your Hermes home into the container.

## Configuration

All configuration is environment variables. The useful ones:

- `HERMES_GATEWAY_URL` the gateway base URL the deck proxies. Defaults to the
  stock `http://127.0.0.1:8642`; in a container set it to your host, for example
  `http://host.docker.internal:8642`.
- `AGENT_DECK_PORT` the port the deck listens on inside the container (default
  `7878`).
- `AGENT_DECK_TOKEN` the access token. The container always requires one (see
  Signing in above); set this to pin your own instead of using the auto-generated
  token. The token is not a network boundary on its own, so still publish to a
  trusted interface.
- `AGENT_DECK_ENABLE_TERMINAL=1` opt in to the interactive terminal (it runs
  inside the container).
- `AGENT_DECK_TRUSTED_HOSTS` comma separated hostnames to accept when a reverse
  proxy fronts the deck on a custom domain.

The image sets `AGENT_DECK_HOST=0.0.0.0` so the server is reachable through the
published port. That binds every interface inside the container, where the
container network is the boundary and the port you publish is what you expose.

## Security notes

- Publish to `127.0.0.1` (the Compose default) unless you intend LAN or remote
  access. To go wider, change the port mapping and set `AGENT_DECK_TOKEN`.
- Binding a non-loopback host puts the deck in remote mode, which keeps the
  interactive terminal off by default. Leave it off unless you need it.
- The deck reads provider keys and gateway secrets server side only; it never
  sends them to the browser.
