import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Eye, EyeOff, Loader2, Plus } from 'lucide-react'
import type { AddMcpServerRequest, McpTransport } from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * AddMcpServerForm — the guided "Add custom server" form on the Card primitive.
 *
 * Honest + minimal: name + transport (http/stdio) + the matching endpoint field
 * (URL or command + args) + an OPTIONAL masked key. The masked key value is a
 * password field that's cleared on submit so the plaintext never lingers in the
 * DOM; the request carries it ONCE (the BFF stores it via /api/env, never in
 * config.yaml). No OAuth/git-bootstrap here — those flow through the CLI (the
 * catalog surfaces the command), so this form covers direct http/stdio servers.
 *
 * Presentational: it owns its local field state + a `submitting` prop, and emits
 * a validated {@link AddMcpServerRequest} to the route's real mutation.
 */

export interface AddMcpServerFormProps {
  onAdd: (request: AddMcpServerRequest) => void
  submitting: boolean
}

const LABEL = 'text-xs font-medium text-muted-foreground'

export function AddMcpServerForm({ onAdd, submitting }: AddMcpServerFormProps) {
  const nameId = useId()
  const urlId = useId()
  const cmdId = useId()
  const argsId = useId()
  const envId = useId()
  const keyId = useId()

  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [envVar, setEnvVar] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [revealKey, setRevealKey] = useState(false)

  // Roving tabindex for the transport radiogroup: only the checked radio is in
  // the tab order and ArrowLeft/Right (and Up/Down) move selection, matching the
  // WAI-ARIA radio-group keyboard map (the same pattern as PeriodSelector).
  const TRANSPORTS = ['http', 'stdio'] as const
  const transportRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectTransportAt = (index: number) => {
    const next = TRANSPORTS[((index % TRANSPORTS.length) + TRANSPORTS.length) % TRANSPORTS.length]
    if (next === undefined) return
    setTransport(next)
    transportRefs.current[TRANSPORTS.indexOf(next)]?.focus()
  }
  const onTransportKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectTransportAt(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectTransportAt(index - 1)
        break
    }
  }

  const nameValid = /^[A-Za-z0-9_-]+$/.test(name.trim())
  const endpointValid = transport === 'http' ? url.trim() !== '' : command.trim() !== ''
  const keyPairValid = keyValue.trim() === '' || envVar.trim() !== ''
  const canSubmit = name.trim() !== '' && nameValid && endpointValid && keyPairValid && !submitting

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const request: AddMcpServerRequest = {
      name: name.trim(),
      transport,
      ...(transport === 'http'
        ? { url: url.trim() }
        : {
            command: command.trim(),
            ...(args.trim() !== '' ? { args: args.trim().split(/\s+/) } : {}),
          }),
      ...(envVar.trim() !== '' && keyValue.trim() !== ''
        ? { apiKeyEnvVar: envVar.trim(), apiKeyValue: keyValue }
        : {}),
    }
    onAdd(request)
    // Clear the secret immediately so the plaintext never lingers.
    // The rest of the form is reset by the parent remounting it on success.
    setKeyValue('')
    setRevealKey(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a custom tool server</CardTitle>
        <p className="text-13 leading-relaxed text-muted-foreground">
          Use this when you already know the server URL or command. Catalog installs stay in your
          terminal.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={submit}
          aria-label="Add a custom MCP server"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className={LABEL}>
              Name
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={name.trim() !== '' && !nameValid}
            />
            {name.trim() !== '' && !nameValid ? (
              <p className="text-[11px] text-destructive">
                Use letters, digits, dashes, and underscores only.
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={cn(LABEL, 'mb-1.5')}>Transport</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Transport">
              {TRANSPORTS.map((t, index) => {
                const selected = transport === t
                return (
                  <button
                    key={t}
                    ref={(el) => {
                      transportRefs.current[index] = el
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    // Roving tabindex: only the checked radio is reachable via Tab;
                    // the arrow keys traverse the rest.
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTransport(t)}
                    onKeyDown={(e) => onTransportKeyDown(e, index)}
                    className={cn(
                      'h-10 flex-1 rounded-lg border px-3 text-13 font-medium transition-colors',
                      'focus-visible:ad-focus',
                      selected
                        ? 'border-[var(--border-strong)] bg-primary/10 text-foreground'
                        : 'border-border bg-surface-1 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'http' ? 'HTTP URL' : 'Local command (stdio)'}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {transport === 'http' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={urlId} className={LABEL}>
                Server URL
              </label>
              <Input
                id={urlId}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={cmdId} className={LABEL}>
                  Command
                </label>
                <Input
                  id={cmdId}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={argsId} className={LABEL}>
                  Arguments{' '}
                  <span className="font-normal text-foreground-tertiary">
                    (optional, space-separated)
                  </span>
                </label>
                <Input
                  id={argsId}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @scope/mcp-server"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-[12px] leading-relaxed text-foreground-tertiary">
              Optional: if this integration needs an API key, store it here. The value is saved
              securely on your machine and never written to your config file.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={envId} className={LABEL}>
                Key name <span className="font-normal text-foreground-tertiary">(env var)</span>
              </label>
              <Input
                id={envId}
                value={envVar}
                onChange={(e) => setEnvVar(e.target.value)}
                placeholder="MCP_MYSERVER_API_KEY"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!keyPairValid}
                aria-describedby={`${envId}-hint`}
              />
              <p id={`${envId}-hint`} className="text-[11px] text-foreground-tertiary">
                The name your integration uses to look up the key. Check the integration&apos;s
                docs.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={keyId} className={LABEL}>
                Key value
              </label>
              <div className="relative">
                <Input
                  id={keyId}
                  type={revealKey ? 'text' : 'password'}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder="Paste the key"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setRevealKey((v) => !v)}
                  aria-label={revealKey ? 'Hide key characters' : 'Show key characters'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-foreground-tertiary transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
                >
                  {revealKey ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>
            {!keyPairValid ? (
              <p className="text-[11px] text-destructive">
                A key value needs an env-var name to store it under.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-stretch gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-relaxed text-foreground-tertiary">
              A new server loads after the gateway restarts.
            </p>
            <Button type="submit" disabled={!canSubmit} className="shrink-0">
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                <>
                  <Plus aria-hidden />
                  Add server
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
