import { ArrowUpRight, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CliBrandMark } from './cliBrandIcons'
import type { CliId, DetectedCli } from './useTerminalClis'

/**
 * The Terminal's "choose your agent" launcher — the calm, premium empty state a
 * newcomer sees first on this surface (not a blank black box). A small row of
 * preset cards — Hermes CLI · Claude Code · Codex · Raw shell — each honestly
 * gated on what's actually installed.
 *
 * HONEST UI: only installed CLIs are actionable; a missing one is muted with a
 * plain "not installed" line + a real "Install →" link to that tool's docs. No
 * fake states, no emoji. The single amber action accent lands on the protagonist
 * (Hermes); the rest use the neutral outline action — identity is never the accent.
 *
 * Each card carries the CLI's recognizable BRAND MARK (a local inline SVG in the
 * tool's own brand color — IDENTITY, never the amber accent); the raw shell uses a
 * neutral line glyph. See {@link CliBrandMark}.
 *
 * Selecting a preset calls {@link onLaunch} with its id; the route then opens a
 * pty with that `cli` (the server seeds the command into the user's own shell).
 */

/** Per-preset copy: one honest line. Framing is "launch the [X] you already have." */
const PRESET_META: Record<CliId, { blurb: string; hint?: string }> = {
  hermes: {
    blurb: 'Launch the Hermes CLI you already have.',
    // Why it's here even though native chat exists: the CLI exposes client-only
    // features the web chat can't (slash commands, the interactive REPL).
    hint: "Client-only features the web chat can't show: slash commands like /compress and /steer, and the interactive REPL.",
  },
  claude: {
    blurb: 'Launch the Claude Code CLI you already have.',
  },
  codex: {
    blurb: 'Launch the Codex CLI you already have.',
  },
  shell: {
    blurb: 'Open a plain interactive shell (the universal fallback).',
  },
}

/** Stable display order: Hermes (protagonist) → Claude → Codex → Raw shell. */
const ORDER: readonly CliId[] = ['hermes', 'claude', 'codex', 'shell']

/**
 * Fallback preset list for when the CLI-detection probe FAILED (so we never get a
 * real list). The raw shell is always actionable (it needs no probe); the agent
 * CLIs are shown as unconfirmed-but-installable with their docs links. The server
 * still gates each preset before spawning, so this stays honest. Install URLs
 * mirror the server's CLI_PRESETS.
 */
const FALLBACK_CLIS: readonly DetectedCli[] = [
  {
    id: 'hermes',
    label: 'Hermes CLI',
    available: false,
    installUrl: 'https://github.com/NousResearch/hermes-agent',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    available: false,
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  },
  {
    id: 'codex',
    label: 'Codex',
    available: false,
    installUrl: 'https://developers.openai.com/codex/cli',
  },
  { id: 'shell', label: 'Raw shell', available: true },
]

export interface TerminalLauncherProps {
  /** The detected CLIs (undefined while still loading → calm placeholder). */
  clis: DetectedCli[] | undefined
  /**
   * The detection probe FAILED (couldn't reach `/clis`). With no list we'd be
   * stuck on the "Checking…" placeholder forever — so we fall back to a usable
   * preset grid (raw shell always actionable) plus an honest note + a Retry.
   */
  failed?: boolean
  /** Re-run the CLI detection probe (shown only in the failed state). */
  onRetry?: () => void
  /** Open a pty for the chosen preset id. */
  onLaunch: (id: CliId) => void
}

export function TerminalLauncher({ clis, failed, onRetry, onLaunch }: TerminalLauncherProps) {
  // Still loading AND not failed → the calm placeholder. A FAILED probe must NOT
  // hang here: it falls through to the fallback preset grid below.
  if (!clis && !failed) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Checking which CLIs are installed…</p>
      </div>
    )
  }

  // On a failed probe with no real list, use the fallback (raw shell actionable).
  const source = clis ?? FALLBACK_CLIS
  const probeFailed = !clis && failed === true
  const byId = new Map(source.map((c) => [c.id, c]))
  const ordered = ORDER.map((id) => byId.get(id)).filter((c): c is DetectedCli => c != null)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <h2 id="terminal-launcher-heading" className="text-base font-medium text-foreground">
            Launch an agent
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Open one of the CLIs you already have installed, right here in a terminal, or a plain
            shell. Each runs as a real process on the host.
          </p>
        </div>
        {probeFailed ? (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">
              Couldn&apos;t check which agent CLIs are installed. You can still open a plain shell;
              the agent CLIs are shown as unconfirmed.
            </span>
            {onRetry ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 md:min-h-7"
                onClick={onRetry}
              >
                <RotateCcw />
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        <ul
          className="mt-5 grid gap-3 sm:grid-cols-2"
          role="list"
          aria-labelledby="terminal-launcher-heading"
        >
          {ordered.map((cli) => (
            <li key={cli.id}>
              <PresetCard cli={cli} onLaunch={onLaunch} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function PresetCard({ cli, onLaunch }: { cli: DetectedCli; onLaunch: (id: CliId) => void }) {
  const meta = PRESET_META[cli.id]
  // The protagonist (Hermes) carries the single amber action accent; everything
  // else uses the neutral outline action. Identity is never the accent.
  const variant = cli.id === 'hermes' ? 'default' : 'outline'
  // The shell glyph + the Codex mono mark use currentColor → tint them to a
  // theme-safe neutral. Hermes uses an <img> (the Nous-girl mark, self-colored);
  // claude uses the ClaudeCode mark which renders in its brand color via @lobehub.
  const usesCurrentColor = cli.id === 'shell' || cli.id === 'codex'
  const tint = usesCurrentColor
    ? cli.available
      ? ' text-foreground'
      : ' text-muted-foreground'
    : ''

  return (
    <div
      className="ad-surface flex h-full flex-col gap-3 rounded-xl bg-card p-4 text-left"
      data-available={cli.available}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          // Neutral tile holding the BRAND mark (its own color = identity). A
          // missing CLI dims the whole tile so the brand mark reads as "not here".
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${
            cli.available ? '' : 'opacity-45'
          }`}
        >
          <CliBrandMark cli={cli.id} className={`size-4.5${tint}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              cli.available ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {cli.label}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{meta.blurb}</p>
          {meta.hint ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground/85">{meta.hint}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-auto">
        {cli.available ? (
          <Button
            variant={variant}
            size="sm"
            className="min-h-11 w-full md:min-h-7"
            onClick={() => onLaunch(cli.id)}
            aria-label={`Launch the ${cli.label}`}
          >
            Launch
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Not installed</span>
            {cli.installUrl ? (
              <a
                href={cli.installUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Install the ${cli.label} (opens its docs in a new tab)`}
                className="inline-flex min-h-11 items-center gap-1 rounded-sm px-2 text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-strong)] md:min-h-0 md:px-0"
              >
                Install
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
