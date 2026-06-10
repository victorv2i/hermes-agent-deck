/**
 * The Start my agent recovery copy, shared by the {@link ./StartAgentButton}
 * component and the surface tests (chat's unreachable notice, Home's offline
 * tending headline) so the honest strings can't drift. Kept out of the
 * component file so it stays fast-refresh clean (single component export).
 */
export const START_AGENT_COPY = {
  action: 'Start my agent',
  pending: 'Starting your agent. This can take a moment.',
  failureLead: "Couldn't start your agent.",
  failureLink: 'Open the System page',
  failureTail: 'for more options.',
  started: 'Your agent reports running. Reconnecting now.',
} as const
