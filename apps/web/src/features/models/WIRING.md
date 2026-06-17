# Models surface: wiring

Read-only Models surface: lists the configured models / their provider and
highlights the active one. Backed by the hermes dashboard's model-state.

## One-line description

A `/models` page listing the configured models (provider-qualified ids) with
the active model highlighted in sky-blue, plus a provider · reasoning-effort ·
scope summary strip. Read-only in v1.

## NAV entry (apps/web/src/app/navigation.tsx)

Append to the `NAV` array (additive only):

```tsx
import { Boxes } from 'lucide-react'
import { ModelsRoute } from '@/features/models/ModelsRoute'

{
  key: 'models',
  label: 'Models',
  path: '/models',
  icon: Boxes,            // lucide-react, verified present in v1.17.0
  group: 'system',        // existing NAV_GROUPS already includes 'system'
  element: <ModelsRoute />,
}
```

- key: `models`
- label: `Models`
- route path: `/models`
- lucide icon: `Boxes`
- group: `system`

## React route element

- Element: `<ModelsRoute />`
- Import: `import { ModelsRoute } from '@/features/models/ModelsRoute'`

The router (apps/web/src/app/router.tsx) already derives a child route from each
NAV entry (path stripped of the leading slash → `models`). No router edit needed
beyond appending the NAV entry above.

`ModelsRoute` uses `@tanstack/react-query`'s `useQuery` on the single app-wide
client mounted at the root (`apps/web/src/main.tsx`, configured in
`@/lib/queryClient`), through the shared `@/lib/apiFetch`. Tests wrap a throwaway
client locally.

## Fastify route plugin (BFF)

- Export: `registerModelsRoutes` (a `FastifyPluginAsync<ModelsRouteOptions>`)
- Import: `import { registerModelsRoutes } from './models/modelsRoute'`
  (from apps/server/src/app.ts, relative to apps/server/src/)
- Mount base: NO prefix; the plugin declares the absolute path
  `GET /api/agent-deck/models` itself.
- Options: `{ dashboard: DashboardClient }`

Suggested wiring in `buildApp` (apps/server/src/app.ts), after the health route,
constructing the shared dashboard client from config:

```ts
import { DashboardClient } from './hermes/dashboardClient'
import { registerModelsRoutes } from './models/modelsRoute'

const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
await app.register(registerModelsRoutes, { dashboard })
```

`config.hermesDashboardUrl` / `config.hermesDashboardHost` already exist in
`ServerConfig` (apps/server/src/config.ts) with sensible defaults
(`http://127.0.0.1:9123` / `127.0.0.1:9123`).

## Endpoint contract

`GET /api/agent-deck/models` → 200 `ModelsResponse`
(apps/server/src/models/types.ts, mirrored in apps/web/src/features/models/types.ts):

```ts
{
  activeModelId: string
  provider: {
    id: string
    label: string
  }
  reasoningEffort: string
  scope: 'global' | 'channel'
  hasChannelOverride: boolean
  models: {
    id
    label
    provider
    active: boolean
    source
  }
  ;[]
}
```

On any dashboard failure (unreachable / non-2xx / bad payload) → 502
`{ error: string }` (never leaks the dashboard session token).

Source: maps the dashboard's `GET /api/chat/model-state` (verified against the
stock Hermes dashboard server `hermes_cli/web_server.py` (the model list +
`current_model` live there) via the shared `dashboardClient.ts` auth recipe.

## Missing deps

None. Uses `@tanstack/react-query`, `lucide-react`, `react-router-dom` (route),
and the existing `@/components/ui/{badge,button}` + `@/lib/utils`, all present.

## Tests

- BFF: `apps/server/src/models/modelsRoute.test.ts` (6 tests, mock dashboard)
- Web: `apps/web/src/features/models/{ModelsPage,ModelsRoute,api}.test.tsx?`
  (15 tests)

Run only these:

```
pnpm --filter @agent-deck/server exec vitest run src/models/modelsRoute.test.ts
pnpm --filter @agent-deck/web exec vitest run src/features/models/
```
