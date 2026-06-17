import { useState } from 'react'
import { KeyRound, RotateCcw, ServerCog, SlidersHorizontal } from 'lucide-react'
import {
  STUDIO_AUXILIARY_TASKS,
  type StudioAuxiliaryTask,
  type StudioAuxiliaryTaskConfig,
  type StudioConfigSubset,
  type StudioConfigWriteRequest,
} from '@agent-deck/protocol'
import { ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'

/**
 * AdvancedModelSection - the per-agent ADVANCED model + side-model routing in the
 * Studio workbench, rendered under the main model picker. Three honest blocks,
 * each writing ONLY a config key the installed gateway truly honors:
 *
 *  1. Context window override - the top-level `model_context_length` hermes
 *     surfaces (`_normalize_config_for_web`); 0 means auto-detect. A write sends
 *     the CURRENT model id alongside it so hermes' denormalize attaches it to the
 *     model dict (writing 0 clears the override back to auto).
 *  2. Auxiliary task routing - `auxiliary.<task>.{provider, model, base_url,
 *     timeout}` for the side models hermes uses (vision / web extraction /
 *     approval judge / context compression). Verified in cli.py DEFAULT_CONFIG +
 *     agent/auxiliary_client.py.
 *  3. Delegation (subagent) routing - `delegation.{model, provider, base_url,
 *     max_iterations}`. Verified in cli.py DEFAULT_CONFIG.
 *
 * HONESTY (load-bearing):
 *  - NO api_key / extra_body field is offered. A routing KEY for a custom
 *    `base_url` endpoint lives in `.env` (e.g. OPENAI_API_KEY), authored via the
 *    Env section - never this config surface. The protocol subset structurally
 *    strips any api_key, so a value typed here could not be smuggled through.
 *  - "extra-body JSON" for the MAIN model is NOT a real config key in installed
 *    hermes, so it is deliberately absent.
 *  - Every write is config that applies on the agent's NEXT session - one honest
 *    restart line, never a fake instant activation.
 *
 * Presentational: the config/loading/error + the `onSave` config-write arrive as
 * props (the route owns the scoped GET/PUT), so this stays hermetically testable.
 */

export interface AdvancedModelSectionProps {
  config: StudioConfigSubset | undefined
  isLoading: boolean
  error: string | null
  /** Write a partial config patch (context length / auxiliary / delegation). */
  onSave: (patch: StudioConfigWriteRequest['config']) => void | Promise<void>
  /** True while a save is in flight (locks the inputs). */
  isSaving?: boolean
}

const AUX_LABELS: Record<StudioAuxiliaryTask, { label: string; hint: string }> = {
  vision: { label: 'Vision', hint: 'Reads images and screenshots' },
  web_extract: { label: 'Web extraction', hint: 'Pulls readable text from web pages' },
  approval: { label: 'Approval judge', hint: 'Decides whether a guarded action is safe' },
  compression: { label: 'Compression', hint: 'Summarizes long context to fit the window' },
}

export function AdvancedModelSection({
  config,
  isLoading,
  error,
  onSave,
  isSaving = false,
}: AdvancedModelSectionProps) {
  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load advanced options"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !config) return <AdvancedSkeleton />

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-foreground-tertiary" aria-hidden />
        <h3 className="text-13 font-semibold text-foreground">Advanced</h3>
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
        <RotateCcw className="size-3 shrink-0" aria-hidden />
        Restart your agent to apply advanced changes.
      </p>

      <ContextLengthBlock config={config} onSave={onSave} isSaving={isSaving} />
      <AuxiliaryBlock config={config} onSave={onSave} isSaving={isSaving} />
      <DelegationBlock config={config} onSave={onSave} isSaving={isSaving} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Context window override (item 1)                                           */
/* -------------------------------------------------------------------------- */

function ContextLengthBlock({
  config,
  onSave,
  isSaving,
}: {
  config: StudioConfigSubset
  onSave: AdvancedModelSectionProps['onSave']
  isSaving: boolean
}) {
  const current = config.model_context_length ?? 0
  const [draft, setDraft] = useState<string>(current > 0 ? String(current) : '')

  // Keep the field in sync when the upstream value changes (a refetch/another tab).
  const [seen, setSeen] = useState(current)
  if (seen !== current) {
    setSeen(current)
    setDraft(current > 0 ? String(current) : '')
  }

  const parsed = draft.trim() === '' ? 0 : Number(draft)
  const valid = Number.isInteger(parsed) && parsed >= 0
  const dirty = valid && parsed !== current

  return (
    <section className="ad-surface flex flex-col gap-3 rounded-xl bg-card px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <h4 className="text-13 font-medium text-foreground">Context window override</h4>
        <p className="text-xs leading-relaxed text-foreground-tertiary">
          Force a token budget for this model. Leave empty (or 0) to let your agent auto-detect it.
        </p>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!dirty || isSaving || !config.model) return
          // Send the CURRENT model id so hermes attaches the override to the model
          // dict; a value of 0 clears it back to auto on hermes' side.
          void onSave({ model: config.model, model_context_length: parsed })
        }}
      >
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          value={draft}
          disabled={isSaving}
          aria-label="Context window tokens (0 for auto)"
          placeholder="Auto"
          data-testid="studio-context-length-input"
          onChange={(e) => setDraft(e.target.value)}
          className={cn(
            'h-9 w-40 rounded-lg bg-surface-1 px-3 font-mono text-13 text-foreground',
            'focus-visible:ad-focus disabled:opacity-60',
          )}
        />
        <span className="text-xs text-foreground-tertiary">tokens</span>
        <button
          type="submit"
          disabled={!dirty || isSaving || !config.model}
          data-testid="studio-context-length-save"
          className={cn(
            'inline-flex h-9 items-center rounded-lg px-3 text-13 font-medium transition-colors',
            'focus-visible:ad-focus disabled:cursor-default disabled:opacity-50',
            'bg-primary/12 text-primary-hover hover:bg-primary/20',
          )}
        >
          Save
        </button>
        {!config.model && (
          <span className="text-xs text-foreground-tertiary">Set a model first.</span>
        )}
      </form>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Auxiliary task routing (item 2)                                            */
/* -------------------------------------------------------------------------- */

function AuxiliaryBlock({
  config,
  onSave,
  isSaving,
}: {
  config: StudioConfigSubset
  onSave: AdvancedModelSectionProps['onSave']
  isSaving: boolean
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h4 className="text-13 font-medium text-foreground">Side-model routing</h4>
        <p className="text-xs leading-relaxed text-foreground-tertiary">
          Route specific helper tasks to their own model. Leave a field empty to inherit your
          agent&apos;s main model.
        </p>
      </div>
      <KeyNote />
      <div className="flex flex-col gap-2.5">
        {STUDIO_AUXILIARY_TASKS.map((task) => (
          <AuxiliaryTaskRow
            key={task}
            task={task}
            value={config.auxiliary?.[task]}
            isSaving={isSaving}
            onSave={(taskPatch) => onSave({ auxiliary: { [task]: taskPatch } })}
          />
        ))}
      </div>
    </section>
  )
}

function AuxiliaryTaskRow({
  task,
  value,
  isSaving,
  onSave,
}: {
  task: StudioAuxiliaryTask
  value: StudioAuxiliaryTaskConfig | undefined
  isSaving: boolean
  onSave: (patch: StudioAuxiliaryTaskConfig) => void
}) {
  const meta = AUX_LABELS[task]
  const [provider, setProvider] = useState(value?.provider ?? '')
  const [model, setModel] = useState(value?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(value?.base_url ?? '')
  const [timeout, setTimeoutVal] = useState(
    value?.timeout != null ? String(value.timeout) : '',
  )

  const timeoutNum = timeout.trim() === '' ? undefined : Number(timeout)
  const timeoutValid = timeoutNum === undefined || (Number.isFinite(timeoutNum) && timeoutNum >= 0)

  const dirty =
    (provider.trim() || undefined) !== (value?.provider || undefined) ||
    (model.trim() || undefined) !== (value?.model || undefined) ||
    (baseUrl.trim() || undefined) !== (value?.base_url || undefined) ||
    timeoutNum !== (value?.timeout ?? undefined)

  return (
    <form
      data-testid={`studio-aux-${task}`}
      className="ad-surface flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty || !timeoutValid || isSaving) return
        // Send the full intended task block (empty strings clear the field); hermes
        // replaces the key. api_key/extra_body are never part of this surface.
        onSave({
          provider: provider.trim(),
          model: model.trim(),
          base_url: baseUrl.trim(),
          ...(timeoutNum !== undefined ? { timeout: timeoutNum } : {}),
        })
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-13 font-medium text-foreground">{meta.label}</span>
        <span className="text-[11px] text-foreground-tertiary">{meta.hint}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field
          label="Provider"
          placeholder="auto"
          value={provider}
          disabled={isSaving}
          testId={`studio-aux-${task}-provider`}
          onChange={setProvider}
        />
        <Field
          label="Model"
          placeholder="inherit main"
          value={model}
          disabled={isSaving}
          testId={`studio-aux-${task}-model`}
          onChange={setModel}
        />
        <Field
          label="Base URL"
          placeholder="optional endpoint"
          value={baseUrl}
          disabled={isSaving}
          testId={`studio-aux-${task}-base-url`}
          onChange={setBaseUrl}
        />
        <Field
          label="Timeout (s)"
          placeholder="default"
          value={timeout}
          disabled={isSaving}
          numeric
          testId={`studio-aux-${task}-timeout`}
          onChange={setTimeoutVal}
          invalid={!timeoutValid}
        />
      </div>
      <div className="flex justify-end">
        <SaveButton disabled={!dirty || !timeoutValid || isSaving} testId={`studio-aux-${task}-save`} />
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Delegation routing (item 2)                                                */
/* -------------------------------------------------------------------------- */

function DelegationBlock({
  config,
  onSave,
  isSaving,
}: {
  config: StudioConfigSubset
  onSave: AdvancedModelSectionProps['onSave']
  isSaving: boolean
}) {
  const value = config.delegation
  const [provider, setProvider] = useState(value?.provider ?? '')
  const [model, setModel] = useState(value?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(value?.base_url ?? '')
  const [maxIter, setMaxIter] = useState(
    value?.max_iterations != null ? String(value.max_iterations) : '',
  )

  const maxIterNum = maxIter.trim() === '' ? undefined : Number(maxIter)
  const maxIterValid =
    maxIterNum === undefined || (Number.isInteger(maxIterNum) && maxIterNum >= 0)

  const dirty =
    (provider.trim() || undefined) !== (value?.provider || undefined) ||
    (model.trim() || undefined) !== (value?.model || undefined) ||
    (baseUrl.trim() || undefined) !== (value?.base_url || undefined) ||
    maxIterNum !== (value?.max_iterations ?? undefined)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h4 className="text-13 font-medium text-foreground">Subagent routing</h4>
        <p className="text-xs leading-relaxed text-foreground-tertiary">
          The model child agents use when your agent delegates a task. Leave the model empty to
          inherit your agent&apos;s main model.
        </p>
      </div>
      <form
        data-testid="studio-delegation"
        className="ad-surface flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!dirty || !maxIterValid || isSaving) return
          onSave({
            delegation: {
              provider: provider.trim(),
              model: model.trim(),
              base_url: baseUrl.trim(),
              ...(maxIterNum !== undefined ? { max_iterations: maxIterNum } : {}),
            },
          })
        }}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field
            label="Provider"
            placeholder="inherit main"
            value={provider}
            disabled={isSaving}
            testId="studio-delegation-provider"
            onChange={setProvider}
          />
          <Field
            label="Model"
            placeholder="inherit main"
            value={model}
            disabled={isSaving}
            testId="studio-delegation-model"
            onChange={setModel}
          />
          <Field
            label="Base URL"
            placeholder="optional endpoint"
            value={baseUrl}
            disabled={isSaving}
            testId="studio-delegation-base-url"
            onChange={setBaseUrl}
          />
          <Field
            label="Max iterations"
            placeholder="45"
            value={maxIter}
            disabled={isSaving}
            numeric
            testId="studio-delegation-max-iterations"
            onChange={setMaxIter}
            invalid={!maxIterValid}
          />
        </div>
        <div className="flex justify-end">
          <SaveButton disabled={!dirty || !maxIterValid || isSaving} testId="studio-delegation-save" />
        </div>
      </form>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

/** The honest "keys live in Env" note for the custom base_url endpoints. */
function KeyNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground-tertiary">
      <KeyRound className="mt-px size-3 shrink-0" aria-hidden />
      <span>
        A custom Base URL uses the matching provider key from the Env section (for example
        OPENAI_API_KEY). Keys are never set here.
      </span>
    </p>
  )
}

function Field({
  label,
  value,
  placeholder,
  disabled,
  numeric = false,
  invalid = false,
  testId,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  numeric?: boolean
  invalid?: boolean
  testId?: string
  onChange: (next: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-tertiary">
        {label}
      </span>
      <input
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        min={numeric ? 0 : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-9 rounded-lg bg-surface-1 px-3 font-mono text-13 text-foreground',
          'focus-visible:ad-focus disabled:opacity-60',
          invalid && 'ring-1 ring-destructive',
        )}
      />
    </label>
  )
}

function SaveButton({ disabled, testId }: { disabled: boolean; testId: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'inline-flex h-8 items-center rounded-lg px-3 text-12 font-medium transition-colors',
        'focus-visible:ad-focus disabled:cursor-default disabled:opacity-50',
        'bg-primary/12 text-primary-hover hover:bg-primary/20',
      )}
    >
      Save
    </button>
  )
}

function AdvancedSkeleton() {
  return (
    <div data-testid="studio-advanced-skeleton" className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-foreground/[0.06] ring-1 ring-border" />
      ))}
    </div>
  )
}
