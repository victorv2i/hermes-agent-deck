# Files surface: integration wiring (M3)

One-line: a workspace **File browser** (tree + breadcrumb + preview + edit/save + create/rename/delete) at `/files`, reading the dashboard's read-only `/api/workspace/*` through the BFF and writing directly to disk (path-guarded).

## NAV entry (apps/web/src/app/navigation.tsx)

Append to the `NAV` array:

```tsx
import { FolderTree } from 'lucide-react'
import { FilesRoute } from '@/features/files/FilesRoute'

{
  key: 'files',
  label: 'Files',
  path: '/files',
  icon: FolderTree,
  group: 'workspace',   // existing NAV_GROUPS already includes 'workspace'
  element: <FilesRoute />,
},
```

- **key:** `files`
- **label:** `Files`
- **route path:** `/files`
- **lucide icon:** `FolderTree`
- **group:** `workspace`

## React route element + import path

- Element: `<FilesRoute />`
- Import: `import { FilesRoute } from '@/features/files/FilesRoute'` (also a default export).
- The router (apps/web/src/app/router.tsx) already derives child routes 1:1 from `NAV`, so adding the NavItem above is the only edit needed; `/files` maps to a child route automatically.
- `FilesRoute` does NOT consume the chat Outlet context; it is self-contained. It reads the **single app-wide `QueryClient`** mounted at the root (`apps/web/src/main.tsx`, configured in `@/lib/queryClient`); the converged retry policy (skip permanent 4xx) lives there. Data goes through the shared `@/lib/apiFetch`.

## Fastify route plugin (apps/server)

- Export: `filesRoutes` (named) / `default`, in `apps/server/src/files/routes.ts`
  - Signature: `FastifyPluginAsync<{ service: FilesService }>`
- Construct the service from the shared dashboard client and register the plugin with the BFF prefix:

```ts
import { filesRoutes } from './files/routes'
import { FilesService } from './files/filesService'
import { DashboardClient } from './hermes/dashboardClient'

// inside buildApp(config), after cors:
const dashboard = new DashboardClient({
  hermesDashboardUrl: config.hermesDashboardUrl,
  hermesDashboardHost: config.hermesDashboardHost,
})
await app.register(filesRoutes, { service: new FilesService(dashboard), prefix: '/api/agent-deck' })
```

- **Mount base:** `/api/agent-deck` → yields the spec routes:
  - `GET  /api/agent-deck/files/roots`
  - `GET  /api/agent-deck/files?root&path`
  - `GET  /api/agent-deck/files/read?root&path`
  - `GET  /api/agent-deck/files/raw?root&path` (image bytes for `<img>` preview; strict CSP, inline only)
  - `POST /api/agent-deck/files/write` `{ root, path, content }`
  - `POST /api/agent-deck/files/create` `{ root, path, kind: 'file'|'dir' }`
  - `POST /api/agent-deck/files/rename` `{ root, from, to }`
  - `POST /api/agent-deck/files/delete` `{ root, path }`
- The Vite dev proxy already forwards `/api` → the BFF, so the web client's `/api/agent-deck/files/*` calls work in dev with no extra config.

## Data source / behavior notes

- **Reads** (roots, list dir, read file) proxy the dashboard's read-only `/api/workspace/*` via the shared `DashboardClient` (same auth recipe; the session token stays server-side). Confirmed live against `:9123`.
- **Writes** (write/create/rename/delete) and **image raw bytes** are NOT offered by the dashboard (every root reports `read_only: true`, the workspace API is GET-only and text-only). The BFF performs them itself, directly on the filesystem, against the trusted absolute root path the dashboard reports.
- **PATH-GUARD** (apps/server/src/files/pathGuard.ts): every path is normalized (no `..` traversal incl. percent-encoded, no control bytes), confined inside its workspace root (sibling-prefix-safe), and screened against a sensitive denylist (`.env*`, `auth.json`, `config.{yaml,yml,json}`, `settings.*`, `*.pem/*.key/*.p12/*.pfx/*.secret`, `*.db/*.sqlite*`, and anything under `.ssh/.aws/.gnupg/.kube/.docker/secrets`). Sensitive files are blocked for BOTH read and write → HTTP 403.
- **Writability policy** (apps/server/src/files/filesService.ts `listRoots`): the genuine WORK roots (playgrounds, `terminal.cwd`, `workspace`, named-profile workspaces) are **writable** (`readOnly: false`); only the `home` root (hermes_home itself, which holds config/credential files) stays `readOnly: true`. Mutations against a read-only root → 403 `read_only` (the `requireWritable` gate in `guardedAbs`). The UI honestly disables/hides the New/Rename/Delete affordances on a read-only root (FileBrowser), so it never offers a write that can only fail.
- Error mapping: `PathGuardError` → 403, `FilesServiceError` → 404/409/400, upstream failure → 502.

## Missing deps

None. All used deps are pre-installed: `@uiw/react-codemirror` + `@codemirror/lang-{javascript,json,markdown}` (editor, lazy-loaded), `@tanstack/react-query`, `lucide-react`. The editor is `React.lazy`-split so the CodeMirror runtime only downloads on first Edit. Reuses the M1b chat `Markdown` + `CodeBlock` components (imported read-only).

## Tests

- Server: `apps/server/src/files/{pathGuard,filesService,routes}.test.ts` (56 tests; hermetic via the mock dashboard + temp dirs).
- Web: `apps/web/src/features/files/{FileBrowser,FilePreview,FilesRoute}.test.tsx` (20 tests; FilesRoute is a hermetic browse→open→edit→save e2e over a mocked BFF).
- Run only this surface:
  - `pnpm --filter @agent-deck/server exec vitest run src/files/`
  - `pnpm --filter @agent-deck/web exec vitest run src/features/files/`
