# Gateway `:8643` `/v1/runs`: confirmed wire contract

- **Date:** 2026-05-29
- **Source of truth:** read from the Hermes gateway source
  `gateway/platforms/api_server.py` (hermes v0.15.2) handlers `_handle_runs`,
  `_handle_get_run`, `_handle_run_events`, `_handle_run_approval`, `_handle_stop_run`,
  `_make_run_event_callback`, plus `tools/approval.py` for the approval payload shape.
- **Confirmation:** one throwaway run against `http://127.0.0.1:8643` (prompt
  "reply with the single word: pong"). Raw SSE frames captured and matched the source 1:1.
- **No secrets here.** The gateway requires a bearer auth header. The key is the
  top-level `API_SERVER_KEY` in `~/.hermes/config.yaml` (or the `API_SERVER_KEY` env var).


This file is the authoritative transport contract that `packages/protocol`'s
`ChatServerEvent` / command schemas mirror.

---

## Endpoints

| Method | Path                          | Purpose                                   |
|--------|-------------------------------|-------------------------------------------|
| POST   | `/v1/runs`                    | Start a run; returns `run_id` immediately |
| GET    | `/v1/runs/{run_id}`           | Poll current run status                   |
| GET    | `/v1/runs/{run_id}/events`    | SSE stream of structured lifecycle events |
| POST   | `/v1/runs/{run_id}/approval`  | Resolve a pending approval                |
| POST   | `/v1/runs/{run_id}/stop`      | Interrupt a running agent                 |

All require the `Authorization: Bearer <API_SERVER_KEY>` header (401 otherwise).

---

## POST `/v1/runs`: start

### Request body
- `input` (required): `string`, **or** an array of `{role, content}` message objects.
  When an array, the last entry is the user message; earlier entries become
  conversation history (unless `conversation_history` is supplied explicitly).
- `model` (optional): model name; defaults to the gateway's configured model.
- `session_id` (optional): string. If omitted, the gateway uses `run_id` as the
  session id. (The agent-deck BFF passes this through as `RunCommand.session_id`.)
- `instructions` (optional): ephemeral system prompt.
- `previous_response_id` (optional): restore history from a stored `/v1/responses`.
- `conversation_history` (optional): array of `{role, content}`. Takes precedence
  over `previous_response_id`.

Optional header: `X-Hermes-Session-Key`, the long-term memory / approval scope key.

### Response: `202 Accepted`
```json
{ "run_id": "run_<hex>", "status": "started" }
```
The id field is **`run_id`** (string, form `run_<uuid4hex>`). If `X-Hermes-Session-Key`
was sent, it is echoed back as a response header.

### Errors
- `400` `{ "error": { "message, type, code } }`: invalid JSON / missing `input` / bad `conversation_history`.
- `401`: invalid/missing API key.
- `429` `code: rate_limit_exceeded`: more than 10 concurrent runs.

---

## GET `/v1/runs/{run_id}/events`: SSE stream

### Framing
- Content-Type `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Each event is a single frame: `data: {json}\n\n`.
- Keepalive comment every 30s of idle: `: keepalive\n\n`.
- Terminal sentinel comment then stream close: `: stream closed\n\n`.
- **The stream is ephemeral / consume-once.** It is NOT replayable from the gateway;
  the agent-deck BFF buffers frames into a cursor-indexed log to provide durable replay-tail.
- Subscribing within a ~1s window before the run registers is tolerated; otherwise
  `404 code: run_not_found`.

### Event envelope (every SSE frame)
```json
{ "event": "<type>", "run_id": "run_<hex>", "timestamp": <float epoch seconds>, ... }
```
**The raw gateway frames carry `run_id` and `timestamp` but NOT `session_id` or a cursor.**
`session_id` is known to the BFF from the originating `RunCommand` / run-status; the
numeric `cursor` is added by the BFF for replay. The protocol schemas therefore treat
`session_id` and `cursor` as BFF-added (optional on the wire from the gateway, present on
the durable `/chat-run` Socket.IO surface).

### Events actually emitted on `/v1/runs/{id}/events` (confirmed)
Live run emitted, in order: `message.delta`, `reasoning.available`, `run.completed`.
Full set the handler can emit on this stream (from source):

| `event`              | Extra payload fields (beyond envelope)                                   | When |
|----------------------|--------------------------------------------------------------------------|------|
| `message.delta`      | `delta: string`                                                          | each streamed assistant text chunk |
| `reasoning.available`| `text: string`                                                           | reasoning/thinking summary became available |
| `tool.started`       | `tool: string`, `preview: string\|null`                                  | a tool call started |
| `tool.completed`     | `tool: string`, `duration: number`, `error: boolean`                     | a tool call finished |
| `approval.request`   | `command: string`, `description: string`, `pattern_key: string`, `pattern_keys: string[]`, `choices: ["once","session","always","deny"]` | agent needs approval to run a dangerous command |
| `approval.responded` | `choice: "once"\|"session"\|"always"\|"deny"`, `resolved: number`        | an approval was resolved (also pushed by POST /approval) |
| `run.completed`      | `output: string`, `usage: {input_tokens, output_tokens, total_tokens}`   | run finished successfully |
| `run.failed`         | `error: string`                                                          | run failed (raised or structured `failed:true`) |
| `run.cancelled`      | (envelope only)                                                          | run task was cancelled |

Notes:
- `approval.request` is built by merging the agent's `approval_data`
  (`command`, `description`, `pattern_key`, `pattern_keys`) with the gateway-added
  `event`/`run_id`/`timestamp`/`choices`. There is **no separate `approval_id`** on the
  gateway wire; the `run_id` identifies the pending approval; POST `/approval` resolves
  the run's single active approval. The protocol carries an optional `approval_id`
  (BFF-assigned, for UI correlation when multiple approvals occur in one run).
- `_thinking` and `subagent_progress` are intentionally **not** forwarded on this path
  (no nested-agent UI via this transport).

### Events in the spec vocabulary that are NOT raw `/v1/runs` SSE frames
Captured for completeness so the protocol union documents reality:
- `run.started`, `message.started`, `tool.failed`, `tool.progress`: these are emitted by
  the **separate** session-scoped channel `POST /api/sessions/{id}/chat/stream` (envelope
  `{event, session_id, run_id, seq, ts, ...}`, event names `assistant.delta`,
  `assistant.completed`, `tool.progress`, etc.), **not** by `/v1/runs/{id}/events`.
- `run.stopping`: only a **status** value (`_set_run_status(..., "stopping")`); it is the
  POST `/stop` response status, not an SSE frame.

The agent-deck BFF synthesizes `run.started` (on POST `/v1/runs` 202) and may surface
`run.stopping` (on POST `/stop`) onto the durable `/chat-run` surface so the client has a
uniform vocabulary. The protocol union therefore includes these as valid `ChatServerEvent`s.

---

## GET `/v1/runs/{run_id}`: poll status
`200` with the run-status object; `404 code: run_not_found` if unknown.
```json
{
  "object": "hermes.run",
  "run_id": "run_<hex>",
  "status": "queued|running|waiting_for_approval|stopping|completed|failed|cancelled",
  "created_at": <float>, "updated_at": <float>,
  "session_id": "<id>", "model": "<name>",
  "last_event": "<last event name>",
  "output": "<string, when completed>",
  "usage": { "input_tokens": N, "output_tokens": N, "total_tokens": N },
  "error": "<string, when failed>"
}
```
Terminal status is retained ~3600s for polling; live streams are swept after ~300s.

---

## POST `/v1/runs/{run_id}/approval`: resolve approval

### Request body
- `choice` (required): one of `once`, `session`, `always`, `deny`.
  Aliases accepted and normalized: `approve`/`approved`/`allow` → `once`.
- `all` or `resolve_all` (optional bool): resolve all pending approvals at once.

### Response: `200`
```json
{ "object": "hermes.run.approval_response", "run_id": "run_<hex>", "choice": "<choice>", "resolved": <int> }
```
Also pushes an `approval.responded` SSE frame on the run's stream.

### Errors
- `400 code: invalid_approval_choice`: choice not in the allowed set.
- `404 code: run_not_found`: unknown run.
- `409 code: approval_not_active` / `approval_not_pending`: no approval to resolve.

---

## POST `/v1/runs/{run_id}/stop`: interrupt

No body required. Sets status `stopping`, calls `agent.interrupt(...)`, cancels the task
(bounded 5s wait).

### Response: `200`
```json
{ "run_id": "run_<hex>", "status": "stopping" }
```
A `run.cancelled` SSE frame typically follows on the events stream. `404 code: run_not_found`
if neither an active agent nor task exists for the id.

---

## Live end-to-end confirmation through the agent-deck BFF (2026-05-29)

Stage 3 confirmatory smoke (NOT part of the hermetic `pnpm verify` gate). Script:
`apps/server/scripts/smoke-chat-live.mjs` builds the agent-deck Fastify app,
attaches the `/chat-run` Socket.IO namespace, listens on an ephemeral loopback
port, connects a `socket.io-client`, emits `run { input: "reply with the single
word: pong" }`, and prints each streamed `ChatServerEvent` until `run.completed`.
The gateway `API_SERVER_KEY` is read server-side by the BFF and is never printed.

Run command:

```
pnpm --filter @agent-deck/server exec tsx scripts/smoke-chat-live.mjs
```

Captured output (real agent reply streamed through the BFF from the live gateway `:8643`):

```
=== agent-deck live /chat-run smoke ===
gateway:    http://127.0.0.1:8643
api key:    present (server-side)
prompt:     "reply with the single word: pong"

agent-deck BFF listening on http://127.0.0.1:45825
connecting socket.io-client to /chat-run ...

socket connected; emitting `run` ...
  [run.started] {"event":"run.started","run_id":"run_e97b8e6247c843498fd9a0d38276724d","input":"reply with the single word: pong","cursor":1}
  [message.delta] cursor=2 delta="pong"
  [reasoning.available] {"event":"reasoning.available","run_id":"run_e97b8e6247c843498fd9a0d38276724d","timestamp":1780074184.9133615,"text":"pong","cursor":3}
  [run.completed] cursor=4 output="pong" usage={"input_tokens":18866,"output_tokens":5,"total_tokens":18871}

=== SMOKE PASS ===
event sequence: run.started -> message.delta -> reasoning.available -> run.completed
assembled assistant text: "pong"
A real agent reply streamed through the BFF from the live gateway :8643.
```

This proves the full pipe: agent-deck BFF → gateway `:8643` `POST /v1/runs` →
`GET /v1/runs/{id}/events` SSE → `parseSse` → `mapGatewayEvent` →
`RunStore` (cursor-tagged) → durable `/chat-run` named-event surface →
`socket.io-client`. Note the BFF synthesizes `run.started` (cursor 1) on the
`POST /v1/runs` 202, then streams the gateway's real `message.delta` /
`reasoning.available` / `run.completed` frames, matching the contract above.

---

## Chat e2e: hermetic chat e2e + live browser smoke (2026-05-29)

### Hermetic Playwright chat e2e (PART of the `pnpm verify` gate)

`e2e/chat.spec.ts` (Playwright project `chat`) drives the full chat interaction
loop in a real browser against a dedicated BFF instance wired to an **in-process
mock gateway**, no live `:8643`, fully hermetic and deterministic.

- `apps/server/src/hermes/mockGatewayClient.test-support.ts`: `MockGatewayClient`
  implements the `GatewayClientLike` surface (`startRun` / `streamRun` /
  `respondApproval` / `stopRun`) with no network. It streams a scripted run:
  `message.delta ×3` → `tool.started`/`tool.completed` (bash) →
  `approval.request` (pauses until resolved/stopped) → on Allow `approval.responded`
  + `message.delta ×2` + `run.completed`; on Stop `run.cancelled`.
- `apps/server/scripts/serve-mock-gateway.mjs`: boots `buildApp`/`attachChat`
  with the mock injected; the Playwright `webServer` runs it on `:7879`, with a
  second Vite dev server (`:5174`, `AGENT_DECK_BFF_TARGET=http://127.0.0.1:7879`).
- `attachChat(app, config, gateway?)` now accepts an injected `GatewayClientLike`
  (defaults to the real `GatewayClient`), so the production build never references
  the test-support mock (verified: no `*mock*` files in `apps/server/dist`).
- The e2e asserts: streamed assistant text renders, an expandable tool chip
  (collapsed → click → reveals detail), the inline approval card + a round-trip
  (Allow once → card clears → run completes), the final assembled message, and
  Stop/abort halting an in-flight run, all console-clean.
- Server-side counterpart `apps/server/src/hermes/mockGatewayClient.test.ts`
  asserts the same scripted sequence + gap-free cursors at the socket-event level.

### Live browser smoke (CONFIRMATORY, NOT gated)

`e2e/chat.live.spec.ts` (Playwright project `live`, opt-in only) drives a real
"say hi" through the browser against the REAL BFF + live gateway `:8643` and
confirms a real streamed reply renders, the run completes (Stop → Send), and a
non-empty assistant turn appears. The default `pnpm e2e` runs only the hermetic
`smoke` + `chat` projects; the `live` project is added only when opted in:

```
AGENT_DECK_LIVE_SMOKE=1 pnpm e2e --project=live
```

Captured 2026-05-29 (real gateway `:8643` up): **1 passed (9.7s)**; the user
turn echoed, `Stop` appeared while the real run streamed, then reverted to `Send`
on completion with a non-empty assistant reply rendered in the warm-void UI. The
gateway API key is read server-side only and never reaches the browser.

---

## Native-sync validation: do gateway `:8643` runs surface in the dashboard `/api/sessions`? (2026-05-29)

**Question:** does a gateway-initiated run show up in the dashboard's session
list, i.e. is there native sync through the shared `state.db`, or must the BFF
read `state.db` directly?

**Result: CONFIRMED, gateway runs DO surface natively. No direct `state.db`
read-path is needed.**

**Method (read-only; nothing restarted).** With the gateway `:8643`
(`/v1/health` → `{status: ok, platform: hermes-agent}`) and the dashboard `:9123`
(`/api/status` → `gateway_state: running`) both up, ran the documented same-host
auth recipe and read the session list/detail/messages:

1. `GET :9123/api/auth/session-token` with `Origin: http://127.0.0.1:9123` →
   ephemeral token (never logged).
2. `GET :9123/api/sessions?limit=100` with `Authorization: Bearer <token>`.
3. `GET :9123/api/sessions/{run_id}` and `.../messages` for a `run_`-id session.

**Findings:**
- Runs tagged `source: "api_server"` appear in the session list; that is the
  gateway's own originator tag (the `:8643` API server in
  `gateway/platforms/api_server.py`). Runs carry the `run_<hex>` id form the
  gateway assigns when `session_id` is omitted on `POST /v1/runs` (per
  §"POST /v1/runs" above: "the gateway uses `run_id` as the session id").
- Such a session's **detail route resolves** (`GET /api/sessions/{run_id}` → 200,
  `source: api_server`, full cost/token/model metadata) and its **messages route
  returns HTTP 200**.

**Conclusion / contract.** The gateway `:8643` and the dashboard `:9123` share
the same `~/.hermes` `state.db`; a run started through `POST /v1/runs` is
persisted there and is immediately visible through the dashboard session API the
agent-deck BFF already consumes (`/api/sessions`, `/api/sessions/{id}`,
`/api/sessions/{id}/messages`). The agent-deck Sessions surface therefore needs
**no** state.db read-path; the existing dashboard proxy is sufficient, and a
chat run the BFF starts via the gateway will appear in the Sessions list as a
`source: api_server` / `run_<hex>` entry with no extra wiring.

**Not a release gate.** This is an informational validation; the BFF does not
depend on it (chat works regardless). Portability note: for an install lacking
this dashboard, the fallback remains reading `state.db` directly.
