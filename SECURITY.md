# Security Policy

## Supported versions

Agent Deck is pre-1.0 and ships from the `main` branch. Security fixes land on `main`, so please run the latest version.

## Reporting a vulnerability

Please report security issues privately, not in a public issue.

- Preferred: open a private report via GitHub Security Advisories (the "Report a vulnerability" button on the repository's **Security** tab).
- Alternative: email the repository owner (see the owner's GitHub profile).

Include steps to reproduce, the affected version or commit, and the impact. We aim to acknowledge within a few days and to ship a fix or mitigation as quickly as the issue warrants. Please allow a reasonable window to address the issue before any public disclosure.

## Threat model (summary)

Agent Deck is safe by default and explicit about its boundaries. The full model is in the README "Security" section. In short:

- Loopback bind (`127.0.0.1`, `localhost`, `::1`) is frictionless, with no token.
- Any non-loopback bind automatically requires a bearer token, enforces a `Host` allowlist (DNS-rebinding defense) and a CORS Origin allowlist, and sends hardening headers (CSP, `nosniff`, `X-Frame-Options: DENY`).
- Broad wildcard binds (`0.0.0.0`, `::`) are refused unless you explicitly set `AGENT_DECK_UNSAFE_BIND=1`.
- The built-in terminal is off by default on remote binds.
- Provider credentials and the gateway/dashboard tokens are held server-side by the local BFF and are never returned to the browser.

The real network boundary for remote access is your Tailscale ACL or LAN firewall. Treat any non-loopback exposure as sensitive.
