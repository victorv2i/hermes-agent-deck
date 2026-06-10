# Sessions surface: wiring

One-line: the live hermes **session rail** (grouped Today/Yesterday/Earlier, legible full-text search, selection) + a **History view** that renders a real transcript with the M1b chat components, a prominent **Continue** that resumes the session across `/chat-run`, and a no-backend transcript export. Read-only over the loopback dashboard (`:9123`).

## NAV entry (app/navigation.tsx)

The History view is a routed surface; the rail itself lives inside the AppShell rail (see "Rail placement" below). Add this NavItem so the History route is registered and reachable:

```ts
import { History } from 'lucide-react'
import { SessionsRoute } from '@/features/sessions/SessionsRoute'

{
  key: 'sessions',
  label: 'Sessions',
  path: '/sessions/:id',   // History view; opened by clicking a rail row
  icon: History,
  group: 'chat',
  element: <SessionsRoute />,
}
```

- key: `sessions`
- label: `Sessions`
- route path: `/sessions/:id`
- lucide icon: `History`
- group: `chat`

Note: because the router (app/router.tsx) maps every NAV item 1:1 to a route and the rail (Sidebar) renders every NAV item as a link, you likely do NOT want this dynamic `:id` route to appear as a clickable rail link. Two options for the integrator:

1. Keep it in NAV but give it a `hidden?: boolean` flag the Sidebar skips (smallest change), or
2. Register the History route directly in `app/router.tsx` as a child route of `/` (`{ path: 'sessions/:id', element: <SessionsRoute /> }`) and DON'T add it to NAV.

Option 2 is cleaner (the rail is the entry point, not a nav link).

## React route element

- import: `import { SessionsRoute } from '@/features/sessions/SessionsRoute'`
- element: `<SessionsRoute />`
- path: `/sessions/:id` (reads `:id` param)

## Rail placement (REQUIRED)

The connected rail list belongs in the AppShell left rail, below "New chat":

```tsx
import { useNavigate, useParams } from 'react-router-dom'
import { SessionList } from '@/features/sessions/SessionList'

const navigate = useNavigate()
const { id } = useParams<{ id: string }>()

<SessionList
  selectedId={id ?? null}
  onSelect={(sid) => navigate(`/sessions/${sid}`)}
/>
```

This replaces the M1b "Sessions arrive in M2." placeholder in `components/layout/Sidebar.tsx`. The integrator should swap that placeholder `<p>` for `<SessionList … />`. (Sidebar is a shared file, left for the integrator to keep features decoupled.)

## Fastify route plugin (backend)

- export: `registerSessionRoutes(app, { dashboard })` from `apps/server/src/sessions/routes.ts`
- import: `import { registerSessionRoutes } from './sessions/routes'`
- mount base: routes self-register their full paths under `/api/agent-deck` (no prefix needed). Call it inside `buildApp` after CORS:

```ts
import { DashboardClient } from './hermes/dashboardClient'
import { registerSessionRoutes } from './sessions/routes'

const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
await registerSessionRoutes(app, { dashboard })
```

Routes exposed:

- `GET /api/agent-deck/sessions?limit&offset&source` → `{ sessions, total }`
- `GET /api/agent-deck/sessions/:id` → `SessionDetail`
- `GET /api/agent-deck/sessions/:id/messages` → `{ session_id, messages }`
- `GET /api/agent-deck/search/sessions?q=` → `{ results }`

Upstream errors are mapped honestly: dashboard 404 → 404, anything else → 502. The dashboard session token is held server-side by `DashboardClient` and never enters a response/log.

## React Query

The Sessions hooks use `@tanstack/react-query` on the single app-wide client
mounted at the root (`apps/web/src/main.tsx`, configured in `@/lib/queryClient`).
Data goes through the shared `@/lib/apiFetch`.

## Continue / resume-across-sessions (REQUIRED to fully close the loop)

`SessionsRoute`'s "Continue" navigates to `/?continue=<sessionId>` (decoupled, no shared chat file edited here). To actually resume, the integrator wires the Chat surface to read that param and start a run carrying `session_id`:

- `RunCommand` already supports `session_id` (packages/protocol chat-events.ts), and `ChatSocket.run({ input, session_id })` forwards it. The BFF must pass `session_id` through to the gateway `POST /v1/runs` so the gateway resumes the existing hermes session (verify the gateway honors a passed session id; if not, document the reconcile path).
- Suggested: in `ChatRoute`/the chat layer, on mount read `?continue=<id>` (and/or preload that session's transcript into the chat store via `applyEvents`/a history seed) so the user sees the prior turns, then `run({ input, session_id })` on their next send.

## Rename + model/workspace switch: NO SESSION-MUTATION BACKEND

The confirmed dashboard build (the stock Hermes dashboard server `hermes_cli/web_server.py`) exposes **NO** session-mutation HTTP route: `set_session_title` exists only internally (used during chat), and there is no `@app.post/put/patch` for title, model, or workspace. So:

- `SessionList` does **not** render a rename affordance at all (T1.9). A permanently-disabled, hover-revealed pencil reads as broken, so it was removed rather than shipped disabled. Re-introduce an inline-rename control here once a real mutation route lands.
- `SessionHistory` shows the model chip as a **disabled** "Switch model" control with an explanatory title.

## Missing deps

None. `@tanstack/react-query`, `react-router-dom`, and `lucide-react` are all installed for `@agent-deck/web`. The server `sessions/` module is intentionally zod-free (the server package does not depend on zod; validation lives in the pure mappers).

## Native-sync note (Stage 3 follow-up)

These routes read the dashboard's `/api/sessions*`, which is backed by the shared `state.db`. Gateway-`:8643`-initiated runs are expected to surface there too (same DB). A live smoke should confirm a gateway run appears in this rail; if it does not, add a `state.db` read path / run→session reconcile and append findings to the contract doc (the stock Hermes dashboard contract). Not yet validated in this build (no live read performed here).

## Files

Backend (`apps/server/src/sessions/`):

- `sessionTypes.ts`: feature-local wire types (plain TS).
- `sessionMappers.ts`: pure dashboard→wire mappers (+ `sessionMappers.test.ts`).
- `routes.ts`: `registerSessionRoutes` Fastify plugin (+ `routes.test.ts`, hermetic via the existing `mockDashboard.test-support.ts`).

Frontend (`apps/web/src/features/sessions/`):

- `types.ts`: web mirror of the wire types.
- `api.ts`: fetch helpers for the BFF REST.
- `hooks.ts`: `useSessions / useSession / useSessionMessages / useSessionSearch` (TanStack Query).
- `grouping.ts`: Today/Yesterday/Earlier bucketing + relative-age labels (+ test).
- `transcript.ts`: `transcriptToTurns` (SessionMessage[] → chat-store Turn[]) (+ test).
- `searchSnippet.ts`: `parseHighlight` / `humanizeSnippet`: style the backend `<b>` match markers and humanize raw-JSON snippets so search is legible (T1.7) (+ test).
- `export.ts`: `buildExport` / `exportFilename` / `triggerDownload`: client-side md/json transcript export (T2.4) (+ test).
- `TranscriptExportMenu.tsx`: the History header's export overflow menu (Radix popover + toast).
- `SessionList.tsx`: `SessionList` (connected) + `SessionListView` (presentational) (+ test).
- `SessionHistory.tsx`: `SessionHistoryView` (transcript + Continue + SurfaceHeader + export) (+ test).
- `SessionsRoute.tsx`: the `/sessions/:id` route element.
- `sessions.e2e.test.tsx`: hermetic list→open→continue e2e (mocked fetch + real QueryClient + memory router).

```

```
