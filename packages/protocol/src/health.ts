import { z } from 'zod'

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  hermes: z.object({
    reachable: z.boolean(),
    endpoint: z.string().nullable(),
    platform: z.string().nullable(),
  }),
  /**
   * Bind posture so the client can be HONEST about remote mode. `remote` is true
   * when the server is bound to a NON-loopback host (reachable by other
   * machines) — the web header shows a REMOTE-MODE warning banner. `authRequired`
   * is true when API/socket access is bearer-token gated, including loopback
   * deployments explicitly forced into auth for a reverse proxy. `terminalEnabled`
   * reflects the terminal gate.
   *
   * `authRequired` is optional with a default of `false` so a stale co-deployed
   * server that omits the field does not fail-open on a FORCE_AUTH deploy — the
   * client safely treats an absent field as "no auth required" rather than crashing
   * the parse. Current servers always send the field explicitly.
   */
  bind: z.object({
    remote: z.boolean(),
    terminalEnabled: z.boolean(),
    authRequired: z.boolean().optional().default(false),
  }),
  version: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponse>
