const OFFLINE_OR_BLOCKED_RE =
  /failed to fetch|networkerror|network error|load failed|err_connection|econnrefused|enotfound|offline/i

export const PROVIDER_OAUTH_FALLBACK_COPY =
  'If browser sign-in is blocked or your provider only issues keys, use the API-key fallback. Use a terminal only for provider flows Hermes cannot start from the browser.'

export const PROVIDER_OAUTH_POPUP_COPY =
  'If no new tab opened, use the sign-in link below. The browser may have blocked the popup.'

export function providerOAuthErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : ''
  if (message && OFFLINE_OR_BLOCKED_RE.test(message)) {
    return 'Agentdeck could not reach Hermes provider sign-in. Make sure your agent and the Hermes dashboard are running, then try again. If OAuth is blocked or offline, use the API-key fallback; use a terminal only for provider flows Hermes cannot start from the browser.'
  }
  return message || fallback
}
