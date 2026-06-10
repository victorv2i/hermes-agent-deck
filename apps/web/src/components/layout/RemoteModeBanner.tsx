import { TriangleAlert } from 'lucide-react'

/**
 * REMOTE-MODE warning banner. Shown in the app header ONLY when the server is
 * bound to a non-loopback host (reachable by other machines). It states the
 * honest truth plainly and calmly: the access token authenticates the browser,
 * it is NOT a network boundary — anyone who can reach this server can drive the
 * agent.
 *
 * Styled with the DESTRUCTIVE semantic color (not the amber accent): a tinted
 * surface + a hairline, so it reads as a standing caution rather than a flashing
 * alarm. Amber is reserved for primary/active state (design language §2), so a
 * security caution must use a semantic color instead.
 */
export function RemoteModeBanner() {
  return (
    <div
      role="alert"
      data-testid="remote-mode-banner"
      className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-center text-[13px] leading-snug text-destructive"
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Remote mode.</span> Anyone who can reach this can drive the
        agent; the token is not a network boundary.
      </span>
    </div>
  )
}
