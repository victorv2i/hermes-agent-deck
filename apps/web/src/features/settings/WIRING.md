# Settings surface: wiring

1-line: A read-only, section-grouped view of the hermes config (`/settings`), sourced from the dashboard and fully secret-redacted server-side.

## NAV entry (apps/web/src/app/navigation.tsx)

Append to the `NAV` array:

```tsx
import { Settings } from 'lucide-react'
import { SettingsPage } from '@/features/settings'

{
  key: 'settings',
  label: 'Settings',
  path: '/settings',
  icon: Settings,
  group: 'system',
  element: <SettingsPage />,
},
```

- key: `settings`
- label: `Settings`
- route path: `/settings`
- lucide icon: `Settings`
- group: `system`

## React route element

- Element: `<SettingsPage />`
- Import: `import { SettingsPage } from '@/features/settings'`
  (barrel at `apps/web/src/features/settings/index.ts`; also exportable directly from `@/features/settings/SettingsPage`)
- The router (apps/web/src/app/router.tsx) derives routes from NAV automatically; once the NAV entry above is added, the `/settings` child route renders `<SettingsPage />`. No router edit needed.
- This surface does NOT consume the chat `ChatOutletContext` (it never calls `useOutletContext`), so it is safe under the existing `App` layout Outlet.

## Fastify route plugin (apps/server/src/settings/settingsRoutes.ts)

- Export: `registerSettingsRoutes: FastifyPluginAsync<SettingsRoutesOptions>`
- Import: `import { registerSettingsRoutes } from './settings/settingsRoutes'` (from `apps/server/src/app.ts`)
- Mount base: **none**; the route path is already fully qualified as `/api/agent-deck/config`. Register without a prefix.
- Options: requires a shared `DashboardClient` instance:

```ts
import { DashboardClient } from './hermes/dashboardClient'
import { registerSettingsRoutes } from './settings/settingsRoutes'

// inside buildApp(config), after cors:
const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
await app.register(registerSettingsRoutes, { dashboard })
```

(If other surfaces also need a `DashboardClient`, the integrator may construct one shared instance in `buildApp` and pass it to each plugin.)

### Routes exposed

- `GET /api/agent-deck/config` → `SettingsPayload`
  - Composes dashboard `GET /api/config` (values) + `GET /api/config/schema` (field metadata + category order) via `dashboardClient.getJson`.
  - Returns `{ sections: [{ category, fields: [{ key, label, description, type, options?, value, isSecret }] }], editable: false }`.
  - 502 on dashboard unreachable / 500 otherwise, body `{ error }`.
- `POST /api/agent-deck/config/field` (`{ key, value }`) → `{ ok, key, value }`
  - **Guarded single-field write** for a short allowlist of safe, non-secret scalars (`timezone`, `agent.max_turns`; see `apps/server/src/settings/configWrite.ts`). Anything off the allowlist → 400 before any dashboard call.
  - Read-modify-write: `getJson('/api/config')` (FULL, unredacted) → patch the one dot-path → `putJson('/api/config', { config })`. Untouched keys (incl. credentials) round-trip verbatim; the redaction is NEVER applied to the write body.
  - 400 on a non-allowlisted key / invalid value (writes nothing); 502 on upstream failure.

## Grouping + editability

- The surface is grouped into **"Your preferences"** (local, in-browser: theme/density/reasoning/composer/cost) and **"Agent config"** (the hermes config).
- Agent-config rows whose `key` is on the web allowlist (`editableConfig.ts`, mirroring the server) render an inline `EditableConfigField` (Edit → input → Save through the BFF). Every other row stays read-only with an honest notice pointing at `hermes config` (CLI) + the native dashboard. No dead-end, no fake control.

## Security / write-safety rationale

- The dashboard's `GET /api/config` only strips `_`-prefixed keys, so the raw tree DOES carry live credentials (confirmed against the live dashboard: `API_SERVER_KEY`, provider/auxiliary `api_key`s, etc.). The BFF deeply redacts every secret-bearing value (`apps/server/src/settings/redact.ts`) BEFORE responding; verified against the live config that 0 real secrets leak.
- The dashboard's `PUT /api/config` does a FULL `save_config`, so the write path read-modify-writes the UNREDACTED config to keep secrets intact. Only allowlisted non-secret scalars are writable; a secret field is never editable. The redaction that protects the GET is deliberately not applied to the PUT body.

## Missing deps

- None. All deps used (`lucide-react`, existing `@/components/ui/{card,badge,button}`, `@/lib/utils`) are present. The page loads config via `useSettings` → `@tanstack/react-query` on the single app-wide client (`apps/web/src/main.tsx`, configured in `@/lib/queryClient`), through the shared `@/lib/apiFetch`.

## Files

- apps/server/src/settings/redact.ts (+ redact.test.ts)
- apps/server/src/settings/settingsTypes.ts
- apps/server/src/settings/settingsService.ts (+ settingsService.test.ts)
- apps/server/src/settings/settingsRoutes.ts (+ settingsRoutes.test.ts)
- apps/web/src/features/settings/{types,api,format,useSettings,SettingsPage,index}.ts(x) (+ \*.test.ts(x))

## Tests

- Server: `pnpm --filter @agent-deck/server exec vitest run src/settings/` → 19 pass
- Web: `pnpm --filter @agent-deck/web exec vitest run src/features/settings/` → 22 pass
