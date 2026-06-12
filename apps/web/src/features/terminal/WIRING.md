# Terminal surface: wiring

A real interactive terminal in the browser: an xterm.js front end wired to a BFF
`node-pty` shell over a Socket.IO namespace. The hermes dashboard exposes NO PTY
route (per the M0 spike), so the BFF owns the terminal. Loopback-only; sessions
are capped. When the client supplies a stable `sessionId`, the BFF PARKS the pty
on disconnect (alive for a grace window, output buffered) and REATTACHES + replays
on reconnect, so a browser refresh (or a connect from another machine) resumes the
SAME shell; without a `sessionId` the pty is killed on disconnect as before.
Degrades honestly to a calm "terminal unavailable" panel if `node-pty` did not
build on the host.

1-line description: An interactive workspace shell (xterm.js ↔ BFF node-pty).

## Multi-terminal (tab + grid)

After the launcher picks the FIRST preset, the body is `TerminalMultiView`: many
live shells with a TAB view (one active at a time, "+" to open up to 12) and a
GRID view (several at once; the focused one carries the sanctioned amber ring). A
calm toggle switches modes; inactive tabs stay MOUNTED (hidden) so their shells
keep running. Tabs/grid carry the CLI's local-SVG BRAND mark (`cliBrandIcons.tsx`,
identity, never the amber accent; Hermes uses a tasteful monogram fallback).

Each session = ONE mounted `TerminalView` → its own `TerminalSocket` → its own
socket.io connection → its own server pty. The client sends a STABLE wire id
(`sessionKey` = `id:epoch`) on `terminal.start`; the server keys managed ptys by
that id (live OR parked), so a refresh reattaches and the cap counts every managed
session. Both caps are 12 (`MAX_TERMINALS` web / `DEFAULT_MAX_SESSIONS` server,
`index.ts` also passes `maxSessions: 12`) so the client never lets you exceed what
the server allows. A Restart bumps `epoch` → a new wire id → a fresh shell. The old
shell: a non-tmux parked pty is reaped after its grace window; a tmux-backed
(persistent) one is killed explicitly (`terminal.close`) before the epoch bump so
no `adk_*` session is orphaned.

The open session list is persisted to `localStorage` (`TERMINAL_SESSIONS_KEY`), so a
browser refresh remounts the SAME sessions (same ids) and each reattaches to its
parked shell, the "refresh resumes the same shell" behavior.

## tmux persistence (the strong layer)

With tmux on the host, the server backs every stable-id session with a deck-owned
tmux session (`adk_<sessionKey>`), so shells survive BFF restarts, long
disconnects, and devices. The web layer rides that:

- each tab shows an honest `persistent`/`volatile` badge (from
  `terminal.ready.persistent`); without tmux the launcher says shells are not
  persistent,
- on route load the server's `GET /terminal/sessions` list is the SOURCE OF
  TRUTH: restored localStorage entries whose tmux session is gone are cleaned,
  and forgotten deck sessions are recovered as tabs
  (`reconcileSessions`/`openRecoveredSession` in `terminalSessions.ts`),
- the launcher lists the user's own (foreign) tmux sessions with Attach (the tab
  sends `attach`, close = Detach, never a kill); a deck-owned persistent tab's
  Close asks first, then sends `terminal.close` (a real kill); a tab whose
  persistence is still UNKNOWN (no ready frame yet) also asks first, so a
  close-before-ready never silently orphans an `adk_*` session,
- a restored/recovered session EXPECTS its ready frame to carry `resumed:true`;
  when it does not (the tmux session died between snapshot and mount, so
  `new-session -A` quietly made a fresh shell), the view shows a one-line dim
  notice ("The previous shell ended; this is a fresh one.") instead of letting
  the fresh shell masquerade as the old one (`markRestored`/`expectsResume` in
  `terminalSessions.ts` → `expectResume` on `TerminalView`),
- `TerminalSocket` redials immediately on `visibilitychange`/`pageshow` while
  disconnected, so a phone returning from the background reattaches its shells
  without waiting out socket.io backoff.

## Touch key bar (phones, tablets, touch hybrids)

`MobileKeyBar.tsx` renders below the xterm host on touch-input devices, decided
in JS by `useTouchInput()` (`lib/useMediaQuery.ts`: coarse primary pointer OR
`navigator.maxTouchPoints > 0`, re-checked on resize/orientation change). Keys:
Esc, Tab, ⇧Tab, sticky Ctrl, arrows, ^C, Paste. Taps are focus-safe
(`pointerdown` preventDefault) so the on-screen keyboard never drops. Arrows and
Tab HOLD-REPEAT (350ms delay, then every 60ms; a single tap emits exactly once).
Paste reads `navigator.clipboard.readText()` and writes the text to the shell
input path verbatim (bypassing the sticky-Ctrl transform); a denied or missing
clipboard shows a quiet inline "Clipboard unavailable" notice.

Session state is the pure reducer in `terminalSessions.ts` (open/close/rename/
restart/activate + the tab⇄grid view mode + the 12 cap). The route surfaces the
ACTIVE session's status/clear/restart up to the single SurfaceHeader.

## NAV entry (append to `apps/web/src/app/navigation.tsx` `NAV`)

```ts
import { SquareTerminal } from 'lucide-react'
import { TerminalRoute } from '@/features/terminal/TerminalRoute'

{
  key: 'terminal',
  label: 'Terminal',
  path: '/terminal',
  icon: SquareTerminal,
  group: 'workspace',
  element: <TerminalRoute />,
}
```

- key: `terminal`
- label: `Terminal`
- route path: `/terminal`
- lucide icon: `SquareTerminal`
- group: `workspace`

## React route element + import path

- Element: `<TerminalRoute />`
- Import: `import { TerminalRoute } from '@/features/terminal/TerminalRoute'`

The router (`apps/web/src/app/router.tsx`) already derives a child route from each
`NAV` entry's `path`, so appending the NAV item above is the only web edit needed.
`TerminalRoute` probes `GET /api/agent-deck/terminal/status` via `useTerminalStatus`
→ `@tanstack/react-query` on the single app-wide client (`apps/web/src/main.tsx`),
then **lazy-loads** `TerminalView` (which in turn
dynamically imports `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links`
and the xterm CSS) so the heavy terminal engine stays out of the initial bundle.

## Fastify route plugin (REST status probe)

- Export: `terminalRoutes` (default + named) from
  `apps/server/src/terminal/terminalRoutes.ts`
- Mount base: `/api/agent-deck/terminal`

```ts
import { terminalRoutes } from './terminal/terminalRoutes'
// inside buildApp(), after cors:
await app.register(terminalRoutes, { prefix: '/api/agent-deck/terminal' })
```

Exposes `GET /api/agent-deck/terminal/status → { available, reason? }`. The UI
hits this before dialing the socket so it can render the unavailable panel
instead of a dead WebSocket.

## Socket.IO namespace (the interactive stream)

- Export: `attachTerminal(httpServer, options?)` from
  `apps/server/src/terminal/terminalNamespace.ts`
- Namespace: `/agent-deck-terminal`

Mirrors `attachChat` in `app.ts`. Attach it to the running app's HTTP server in
`index.ts` (NOT inside `buildApp`, since it needs the listening server), e.g.:

```ts
import { attachTerminal } from './terminal/terminalNamespace'
// in index.ts, after attachChat(app, config) and before/after listen:
attachTerminal(app.server, {
  // OPTIONAL: pass allowlisted workspace roots so the shell's cwd defaults to
  // the workspace instead of $HOME. If omitted, cwd falls back to $HOME (safe).
  // roots: await listWorkspaceRootPaths(config),  // via the Files BFF, if desired
})
```

Wire protocol (client ↔ server):

- up: `terminal.start {cols,rows,cwd?,sessionId?}` · `terminal.input <string>` · `terminal.resize {cols,rows}`
- down: `terminal.ready {pid,resumed?}` · `terminal.data <string>` · `terminal.exit {exitCode}` · `terminal.error {message}`

`sessionId` (optional, stable per terminal) enables park/reattach: on reconnect with
the same id the server replays the buffered scrollback then emits
`terminal.ready {resumed:true}`.

### Co-mounting note (avoid a second Socket.IO server on the same HTTP server)

`attachChat` and `attachTerminal` each construct their OWN `new SocketIOServer(...)`
on `app.server`. Two Socket.IO servers on one HTTP server share the same
`/socket.io` engine path and **will conflict**. Pick ONE of:

- (Preferred) Have the integrator create a single `SocketIOServer`, then call the
  registrar functions on it: `registerChatRunHandlers(io, …)` (already exported by
  `chat/chatRun.ts`) and `registerTerminalHandlers(io, options?)` (exported by
  `terminal/terminalNamespace.ts`). Both only call `io.of(<namespace>)`, so they
  coexist cleanly on one server.
- Or keep `attachChat`'s io and additionally call
  `registerTerminalHandlers(<thatIo>, options?)` instead of `attachTerminal(...)`.

`attachTerminal(httpServer, …)` is provided for the standalone/test case and for
parity with `attachChat`; in the wired app prefer `registerTerminalHandlers` on the
existing io to keep a single engine path.

## Files created (all feature-local; no shared files touched)

Server (`apps/server/src/terminal/`):

- `ptyBridge.ts` (+ `.test.ts`, `.smoke.test.ts`): lazy node-pty loader,
  availability probe, shell/cwd/env resolution, `spawnTerminal`. The smoke test
  spawns a REAL shell and is auto-skipped if node-pty can't load.
- `terminalNamespace.ts` (+ `.test.ts`): `/agent-deck-terminal` namespace:
  loopback-origin guard, session cap (default 12), data both ways, resize,
  park/reattach + bounded scrollback replay for stable-`sessionId` sessions,
  teardown on grace-reap/close. `attachTerminal` + `registerTerminalHandlers`.
- `terminalRoutes.ts` (+ `.test.ts`): the `GET /status` Fastify plugin.

Web (`apps/web/src/features/terminal/`):

- `terminalSocket.ts` (+ `.test.ts`): typed socket.io-client framing.
- `terminalTheme.ts` (+ `.test.ts`): warm-void xterm `ITheme` from live CSS vars.
- `TerminalView.tsx` (+ `.test.tsx`): the xterm component (lazy xterm import,
  fit-on-resize, status dot, unavailable/exit overlays). Engine + socket injectable.
- `useTerminalStatus.ts`: the `/status` probe hook (plain fetch).
- `TerminalRoute.tsx` (+ `.test.tsx`): the route: probe → lazy `TerminalView`.

## Tests

- Server: `pnpm --filter @agent-deck/server exec vitest run src/terminal/` (27 tests)
- Web: `pnpm --filter @agent-deck/web exec vitest run src/features/terminal/` (21 tests)

## Missing deps

None. All required deps were pre-installed and verified:

- `node-pty@^1.1.0`: native addon BUILT and loads on this host
  (`apps/server/node_modules/node-pty/build/Release/pty.node`); the real-shell
  smoke test passes. If it ever fails to build, the surface degrades honestly via
  the `/status` probe + the namespace's `terminal.error` frame.
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` (web, all present).
- `socket.io` (server), `socket.io-client` (web), `lucide-react`: all present.

## Security notes

- Loopback / Tailscale only: the namespace's handshake middleware refuses any
  non-loopback `Origin`, and `attachTerminal` sets the same CORS allowlist. The
  BFF already binds `127.0.0.1`. NEVER expose this beyond loopback/Tailscale.
- Session cap (default 12) prevents fork-bombing the host with shells; it counts
  every managed session (live OR parked) so a refresh storm can't exceed it.
- A parked (disconnected) shell is reaped when its grace window elapses; every pty
  is killed on namespace/server close, no orphan shells. The replay buffer is
  bounded to the most-recent tail. No secrets are read, logged, or sent to the browser.
