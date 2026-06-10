import { apiPost } from '@/lib/apiFetch'
import { CliOpResponse, type CliOpRequest } from '@agent-deck/protocol'

/**
 * CLI-OP BFF client — the "Do It For Me" one-click runner.
 *
 *   POST /api/agent-deck/cli-op → CliOpResponse
 *
 * Dispatches a whitelisted hermes CLI op. The request is validated on the server
 * (unknown opIds and invalid provider slugs are rejected before execFile is called).
 * The response is parsed through the shared protocol schema — only the whitelisted,
 * secret-free fields are ever trusted on the client.
 *
 * HONESTY: if the BFF returns ok:false (non-zero exit), the caller receives that
 * honestly. No fake success, no spinner theater.
 */
export async function runCliOp(request: CliOpRequest): Promise<CliOpResponse> {
  return CliOpResponse.parse(await apiPost<unknown>('/api/agent-deck/cli-op', request))
}
