import { useId, useState } from 'react'
import { FileKey, Loader2, Lock, Plus, ServerCog } from 'lucide-react'
import type { StudioEnvResponse } from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { StatusDot } from '@/components/ui/StatusDot'

/**
 * EnvSection — the per-agent secrets view in the Studio workbench. SHAPE-ONLY by
 * contract: it shows WHICH keys are set on disk, never a value (not even a
 * redacted preview reaches the client; see the studio env normalizer). A value is
 * routed only through `PUT /api/env` (the BFF), sent once, never read back.
 *
 * The edit affordance is deliberately write-only: a key + a value to set. No
 * field is ever pre-filled with a secret, so there is nothing to leak on screen.
 *
 * Presentational: env/loading/error + the `onSet` write arrive as props (the
 * route runs the scoped GET/PUT). Config applies on the agent's NEXT session.
 */
export interface EnvSectionProps {
  env: StudioEnvResponse | undefined
  isLoading: boolean
  error: string | null
  /** Set an env var by key. The plaintext value goes to the BFF once, never echoed. */
  onSet: (next: { key: string; value: string }) => void | Promise<void>
  /** True while a set is in flight. */
  isSetting?: boolean
}

export function EnvSection({ env, isLoading, error, onSet, isSetting = false }: EnvSectionProps) {
  const keyId = useId()
  const valueId = useId()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load environment"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !env) return <EnvSkeleton />

  const entries = env.env
  const trimmedKey = key.trim()
  const canSave = trimmedKey.length > 0 && value.length > 0 && !isSetting

  async function handleSave() {
    if (!canSave) return
    await onSet({ key: trimmedKey, value })
    // Clear the value immediately (never keep secret material in component state)
    // and the key, so the form returns to its empty, leak-free baseline.
    setKey('')
    setValue('')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Honest, verbatim privacy boundary: values are never shown here. */}
      <p
        role="note"
        className="ad-surface flex items-start gap-2 rounded-md bg-surface-1/40 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-tertiary"
      >
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          For your security, secret values are never shown here, only whether a key is set. Enter a
          new value to overwrite a key.
        </span>
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={FileKey}
          title="No environment variables set"
          description="This agent has no keys set on disk yet. Add one below; it is written to the agent's .env."
        />
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Environment variables">
          {entries.map((entry) => (
            <li
              key={entry.key}
              data-testid={`studio-env-${entry.key}`}
              className="ad-surface flex items-center gap-3 rounded-md bg-card px-3 py-2.5"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                {entry.key}
              </code>
              {entry.isSet ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground">
                  <StatusDot tone="ok" label="set" />
                  Set
                </span>
              ) : (
                <Badge variant="muted" className="shrink-0">
                  Not set
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Write-only edit: a key + a value, no pre-filled secrets. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSave()
        }}
        className="ad-surface flex flex-col gap-3 rounded-xl bg-surface-1 p-4"
      >
        <div className="grid gap-1.5">
          <label htmlFor={keyId} className="ad-section-label">
            New key
          </label>
          <Input
            id={keyId}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="OPENAI_API_KEY"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={valueId} className="ad-section-label">
            Value
          </label>
          <Input
            id={valueId}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!canSave}>
            {isSetting ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Save key
          </Button>
        </div>
      </form>
    </div>
  )
}

function EnvSkeleton() {
  return (
    <div data-testid="studio-env-skeleton" className="flex flex-col gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[42px] animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border"
        />
      ))}
    </div>
  )
}
