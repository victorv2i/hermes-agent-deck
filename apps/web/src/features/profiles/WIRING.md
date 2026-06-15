# Wiring: Profiles data layer (now behind the Agent Studio)

The profiles BFF lists every Hermes profile (the built-in `default` =
`~/.hermes`, plus any named profiles under `~/.hermes/profiles/<name>/`), showing
model/provider, gateway status, skill count, `.env` presence, the sticky active
profile, and Agent Deck's avatar sidecar. Switching is real but honest: it only
updates Hermes' sticky `active_profile` pointer and tells the user to restart the
gateway.

## Frontend: there is no standalone Profiles page

The dedicated `ProfilesPage` at `/profiles` was RETIRED. The Agents roster and the
per-agent hub it carried folded into the Agent Studio, which is now Home (`/`).
The roster, launchpad, and per-agent workbench (Identity, Soul, Model, Tools,
Memory, Skills, Env) all live in `apps/web/src/features/studio/*`. There is no
`profiles` entry in the `NAV` array.

- The old paths survive as REDIRECTS (apps/web/src/app/router.tsx): `/profiles`
  → `/` (the Studio roster) and `/profiles/:name` → `/?agent=<name>` (Studio with
  that agent open). So existing links and the command palette still land.
- This `features/profiles` folder is still LIVE as the profiles data + identity
  layer the Studio consumes: `useProfiles` (the roster query), `types.ts`
  (`ProfileSummary`, with the `isActive` flag the Studio gates on), the
  `avatarForProfile` sidecar, and the agent lifecycle dialogs/buttons
  (`NewAgentDialog`, `RenameAgentDialog`, `SwitchAgentButton`, `HatchCeremony`,
  `GatewayRestartCard`, `EditAvatarDialog`, `mutations.ts`).
- `useProfiles` reads `GET /api/agent-deck/profiles` via the shared
  `@/lib/apiFetch`, on the single app-wide `@tanstack/react-query` client
  (`apps/web/src/main.tsx`, configured in `@/lib/queryClient`).
- Per-agent authoring (config, model, soul, skills, env) goes through the
  separate profile-SCOPED Studio data layer (`features/studio/data/api.ts` +
  `features/studio/hooks.ts`), not this folder.

## Fastify route plugin (apps/server)

- Export: `profilesRoutes` (a Fastify plugin)
- Import: `import { profilesRoutes } from './profiles/profilesRoute'`
- Mount base: NONE; register with no prefix; the full path is baked in:

```ts
// in apps/server/src/app.ts buildApp(), after cors:
await app.register(profilesRoutes)
// Optionally pass an explicit home: await app.register(profilesRoutes, { hermesHome: config.hermesHome })
```

- Route exposed: `GET /api/agent-deck/profiles`
- Response shape:
  ```ts
  {
    active: string // sticky active profile name ("default" if none)
    profiles: {
      name: string
      displayPath: string // browser-safe label, never an absolute filesystem path
      isDefault: boolean
      isActive: boolean
      model: string | null
      provider: string | null
      hasEnv: boolean // .env presence only, NO secrets are read/returned
      skillCount: number
      gatewayRunning: boolean
    }
    ;[]
  }
  ```
- `hermesHome` resolution (when no option passed): `HERMES_HOME` env → `~/.hermes`.
  Matches the rest of the server. The integrator may pass `config.hermesHome`
  for full consistency, but the default works standalone.

## Data source (why this remains a BFF)

Stock Hermes now exposes profile dashboard routes in the dashboard server
`hermes_cli/web_server.py`:

- `GET /api/profiles` -> `{ profiles: [{ name, path, is_default, model, provider, has_env, skill_count }] }`
- `POST /api/profiles` body `{ name, clone_from_default?, no_skills? }` -> `{ ok, name, path }`
- `PATCH /api/profiles/{name}` body `{ new_name }` -> `{ ok, name, path }`
- `DELETE /api/profiles/{name}` -> `{ ok, path }`
- `GET /api/profiles/{name}/soul` -> `{ content, exists }`
- `PUT /api/profiles/{name}/soul` body `{ content }` -> `{ ok }`
- `GET /api/profiles/{name}/setup-command` -> `{ command }`
- `POST /api/profiles/{name}/open-terminal` -> `{ ok, command }`

Those routes are usable by the native dashboard, but Agent Deck should not proxy
them directly for the Agents surface:

- The stock list/create/rename/delete payloads include absolute `path` values.
  Agent Deck's browser contract uses `displayPath` and never returns absolute
  filesystem paths.
- The stock list does not include Agent Deck's `active`/`isActive` fields,
  `gatewayRunning`, or avatar sidecar.
- Stock HTTP only exposes SOUL; Agent Deck also edits MEMORY and USER.
- Stock HTTP has no profile-use/switch route. Agent Deck writes the sticky
  pointer locally and mirrors Hermes' `set_active_profile("default")` behavior by
  removing `active_profile` when switching back to the built-in agent.
- The filesystem/CLI BFF keeps working when the dashboard token/Host gate is
  unavailable, and returns path-free generic errors for CLI failures.

So the BFF reads the filesystem directly and uses guarded CLI calls where that is
the Hermes-native lifecycle behavior:

- `default` === HERMES_HOME itself
- named profiles under `<home>/profiles/<name>/`, name `^[a-z0-9][a-z0-9_-]{0,63}$`
- active profile = trimmed `<home>/active_profile` (absent/empty → `default`)
- model/provider from `config.yaml` `model` (string, or `{default|model, provider}`)
- gatewayRunning = live PID from `gateway.pid`
- skillCount = `SKILL.md` files under `skills/` (excluding `.hub`/`.git`)

This does NOT use `dashboardClient.ts` for the profile roster or profile file
edits. It does reconcile the active profile's skill count with the dashboard
`/api/skills` set so the Agents surface and Skills browser agree.

## Missing deps

None. Uses `framer-motion`, `lucide-react`, and the existing `@/components/ui/*`
(Card, Badge, Button), all already present. Server uses only `yaml` + node
builtins (already deps).

## Switching caveat (surfaced in UI, by design)

The per-profile "Switch" button writes the sticky active profile but **does not**
itself make the running gateway live on that profile. The UI must show the
restart-required state, offer the browser `Restart gateway` action backed by
`/api/agent-deck/system/gateway/restart`, and report the re-probed gateway state.
The `hermes gateway restart` command is fallback copy only when the browser
restart route fails; it must not be the primary path or claim the gateway has
already switched.

## Tests

- Server: `pnpm --filter @agent-deck/server exec vitest run src/profiles` (20 tests)
- Web: `pnpm --filter @agent-deck/web exec vitest run src/features/profiles` (11 tests)
