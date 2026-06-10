# Usage surface: wiring

One-line: a Usage page with token + cost analytics (period selector 7/14/30d, per-day token trend, per-model breakdown) backed by a BFF over the dashboard's `/api/analytics/usage`.

## NAV entry (apps/web/src/app/navigation.tsx)

Append to the `NAV` array:

```tsx
import { BarChart3 } from 'lucide-react'
import { UsageRoute } from '@/features/usage/UsageRoute'

{
  key: 'usage',
  label: 'Usage',
  path: '/usage',
  icon: BarChart3,
  group: 'system',
  element: <UsageRoute />,
},
```

- key: `usage`
- label: `Usage`
- route path: `/usage`
- lucide icon: `BarChart3`
- group: `system`

## React route element

- Element: `<UsageRoute />`
- Import: `import { UsageRoute } from '@/features/usage/UsageRoute'`
- The router (apps/web/src/app/router.tsx) already derives routes 1:1 from `NAV`, so appending the NavItem above is the only edit needed. `/usage` becomes a child route under `App` and renders in the content Outlet.

## Fastify route plugin (apps/server)

- Plugin export: `usageRoutes` (also default export) from `apps/server/src/usage/usageRoutes.ts`
  - signature: `FastifyPluginAsync<{ usageClient: UsageClient }>`
- Mount base: none; the route declares its full path `GET /api/agent-deck/usage`. Register WITHOUT a prefix.
- Construct the client from the shared `DashboardClient`:

```ts
import { DashboardClient } from './hermes/dashboardClient'
import { UsageClient } from './usage/usageClient'
import { usageRoutes } from './usage/usageRoutes'

const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
await app.register(usageRoutes, { usageClient: new UsageClient(dashboard) })
```

Suggested place: inside `buildApp()` in apps/server/src/app.ts (after the health route). `config.hermesDashboardUrl` / `config.hermesDashboardHost` already exist in `ServerConfig`.

## BFF contract

`GET /api/agent-deck/usage?days=N` (N clamped to [1,365], default 30) →

```json
{
  "periodDays": 7,
  "totals": { "inputTokens", "outputTokens", "cacheReadTokens", "reasoningTokens", "estimatedCost", "actualCost", "sessions" },
  "daily":  [ { "day": "YYYY-MM-DD", "inputTokens", "outputTokens", "cacheReadTokens", "reasoningTokens", "estimatedCost", "actualCost", "sessions" } ],
  "byModel":[ { "model", "inputTokens", "outputTokens", "estimatedCost", "sessions" } ]
}
```

On a dashboard failure the route returns HTTP 502 `{ "error": string }` (token never leaked).

## Dashboard route confirmation

Verified against the stock Hermes dashboard server `hermes_cli/web_server.py`:

- `GET /api/analytics/usage?days=N` (line 4720) returns `{ daily, by_model, totals, period_days }`, gated by `_require_dashboard_chat_read_authorization` (same-host browser session + Bearer session token), satisfied by the shared `DashboardClient`.
- IMPORTANT: there is NO `/api/analytics/models` route on the dashboard. The per-model breakdown IS the `by_model` array on the usage payload above; the BFF surfaces it from there. (The task brief mentioned `/api/analytics/models`, but it does not exist; it is folded into `/api/analytics/usage`.)
- `SUM(...)` columns can be `null`; `usageClient.ts` coerces every numeric field to a finite number.

## Notes / caveats

- No missing deps. Uses already-installed `@tanstack/react-query`, `lucide-react`, and the shared shadcn `Card` + `cn` util. No new chart library; the per-day trend is a hand-rolled SVG/flex bar chart.
- `UsageRoute` reads the **single app-wide `QueryClient`** mounted at the root (`apps/web/src/main.tsx`, configured in `@/lib/queryClient`); it no longer carries its own. Data goes through the shared `@/lib/apiFetch`.
- Files created (all feature-local, none shared touched):
  - server: `apps/server/src/usage/usageClient.ts`, `usageRoutes.ts` (+ `.test.ts` for each)
  - web: `apps/web/src/features/usage/{types,format,api,useUsage}.ts`, `{PeriodSelector,StatCard,UsageTrend,ModelBreakdown,UsagePage,UsageRoute}.tsx` (+ `format.test.ts`, `api.test.ts`, `UsagePage.test.tsx`)
- Tests: `pnpm --filter @agent-deck/server exec vitest run src/usage/` (12 pass) and `pnpm --filter @agent-deck/web exec vitest run src/features/usage/` (14 pass).

```

```
