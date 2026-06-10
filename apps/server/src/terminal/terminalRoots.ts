/**
 * Resolve the root paths used as the terminal pty's cwd fallback.
 *
 * {@link FilesService.listRoots} derives the roots PORTABLY from stock hermes
 * (`GET /api/status` → `hermes_home`, then playgrounds / the configured
 * `terminal.cwd` / any real workspace dirs); stock exposes no workspace API. Crucially
 * `listRoots` now ALWAYS includes `hermes_home` itself when it exists, so on a
 * stock install (which never creates a `workspace/` dir) the terminal still has a
 * real cwd — it no longer depends on the never-created workspace concept. The
 * terminal namespace takes a plain `string[]` of absolute root paths; {@link
 * resolveCwd} (in ptyBridge) opens the shell in the first existing one.
 *
 * This is best-effort at startup: if the dashboard is unreachable (or returns
 * nothing) we return `[]` — never a crash. With no roots and allowHome off, the
 * pty then refuses to spawn rather than dropping the shell into `$HOME`. The
 * dashboard session token never appears here; only root *paths* do.
 */
import type { FilesService } from '../files/filesService'

/**
 * Fetch the dashboard's workspace root absolute paths for the terminal cwd.
 * Returns `[]` on any failure (dashboard down, empty list, etc.); with no roots
 * the pty refuses to spawn unless AGENT_DECK_TERMINAL_ALLOW_HOME=1, in which case
 * it falls back to `$HOME`.
 */
export async function resolveTerminalRoots(
  files: Pick<FilesService, 'listRoots'>,
): Promise<string[]> {
  try {
    const roots = await files.listRoots()
    return roots.map((r) => r.path).filter((p): p is string => typeof p === 'string' && p !== '')
  } catch {
    return []
  }
}

/**
 * Whether the terminal can resolve a safe cwd to spawn the shell in. True iff at
 * least one root resolves OR the operator opted into the $HOME fallback via
 * `AGENT_DECK_TERMINAL_ALLOW_HOME=1` (the same opt-in {@link resolveCwd} honors).
 * On a stock install this is TRUE without any opt-in, because {@link
 * FilesService.listRoots} always surfaces `hermes_home` itself as a root — so the
 * terminal cwd defaults to hermes_home directly rather than depending on a
 * workspace dir that stock never creates. Surfaced in the status probe as
 * `cwd_available` so the UI can render a calm "no workspace" panel BEFORE the
 * real-shell consent gate only when there is genuinely no cwd.
 */
export async function resolveTerminalCwdAvailable(
  files: Pick<FilesService, 'listRoots'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const roots = await resolveTerminalRoots(files)
  if (roots.length > 0) return true
  return env.AGENT_DECK_TERMINAL_ALLOW_HOME === '1'
}
