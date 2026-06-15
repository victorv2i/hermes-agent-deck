import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/apiFetch'
import { updateConfigField } from './api'
import { settingsKeys } from './useSettings'
import { EDITABLE_CONFIG_FIELDS } from './editableConfig'
import { prettyLabel, UNSET } from './format'
import type { SettingsField } from './types'

/**
 * EditableConfigField — the right-hand cell of a config row that the user CAN
 * change. It renders the current value with a quiet "Edit" affordance; choosing
 * Edit reveals an inline input + Save/Cancel. Save writes through the guarded BFF
 * (`POST /api/agent-deck/config/field`, allowlisted scalars only) and, on
 * success, invalidates the settings query so the row reflects the saved value.
 *
 * This is an HONEST control: the field is only rendered editable when it is on
 * the shared allowlist (timezone / agent.max_turns), and the server is the real
 * gate — so the Save action always corresponds to a write that can actually
 * succeed. A failed write keeps the editor open with a specific message rather
 * than silently swallowing the error.
 *
 * Design: the Save action is the one place amber (the action accent) is allowed
 * on this surface; Edit/Cancel are quiet. ≤300ms, no glassmorphism, AA.
 */
export function EditableConfigField({ field }: { field: SettingsField }) {
  const spec = EDITABLE_CONFIG_FIELDS[field.key]
  const queryClient = useQueryClient()
  const inputId = useId()
  const errorId = useId()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const mutation = useMutation({
    mutationFn: (value: string | number) => updateConfigField(field.key, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsKeys.config })
      setEditing(false)
    },
  })

  // Should never happen (caller checks isEditableField first), but stay defensive
  // so a mis-wire degrades to a plain read rather than crashing the page.
  if (!spec) {
    return (
      <span className="font-mono text-13 break-words text-foreground/90">
        {field.value === null || field.value === '' ? UNSET : String(field.value)}
      </span>
    )
  }

  const currentDisplay =
    field.value === null || field.value === undefined || field.value === ''
      ? UNSET
      : String(field.value)

  const beginEdit = () => {
    // Seed the draft from the current value ('' for an unset string field).
    setDraft(field.value === null || field.value === undefined ? '' : String(field.value))
    mutation.reset()
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    mutation.reset()
  }

  const submit = () => {
    const value: string | number = spec.kind === 'number' ? Number(draft) : draft.trim()
    mutation.mutate(value)
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <span
          className={cn(
            'font-mono text-13 leading-relaxed break-words sm:text-right',
            currentDisplay === UNSET ? 'text-foreground-tertiary italic' : 'text-foreground/90',
          )}
          title={currentDisplay}
        >
          {currentDisplay}
        </span>
        <Button variant="ghost" size="xs" onClick={beginEdit} className="shrink-0">
          <Pencil aria-hidden />
          Edit
        </Button>
      </div>
    )
  }

  const errorMessage = mutation.isError ? messageFor(mutation.error) : null

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      <div className="flex w-full items-center gap-2 sm:justify-end">
        <input
          id={inputId}
          type={spec.kind === 'number' ? 'number' : 'text'}
          inputMode={spec.kind === 'number' ? 'numeric' : 'text'}
          {...(spec.kind === 'number' && spec.min !== undefined ? { min: spec.min } : {})}
          {...(spec.kind === 'number' && spec.max !== undefined ? { max: spec.max } : {})}
          value={draft}
          placeholder={spec.placeholder}
          aria-label={`Edit ${prettyLabel(field.label)}`}
          aria-invalid={mutation.isError || undefined}
          aria-describedby={errorMessage ? errorId : undefined}
          disabled={mutation.isPending}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          className={cn(
            'ad-surface h-9 w-full min-w-0 rounded-md bg-surface-1 px-3 font-mono text-13 text-foreground placeholder:text-foreground-tertiary focus-visible:ad-focus sm:max-w-[16rem]',
            mutation.isError && 'border-destructive/50',
          )}
        />
        <Button
          variant="default"
          size="sm"
          onClick={submit}
          disabled={mutation.isPending}
          className="shrink-0"
        >
          <Check aria-hidden />
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={cancel}
          disabled={mutation.isPending}
          aria-label="Cancel"
          title="Cancel"
          className="shrink-0"
        >
          <X aria-hidden />
        </Button>
      </div>
      {spec.hint && (
        <p className="text-xs leading-relaxed text-foreground-tertiary sm:text-right">
          {spec.hint}
        </p>
      )}
      {errorMessage && (
        <p id={errorId} role="alert" className="text-xs text-destructive sm:text-right">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

/** A clean, specific message for a failed write (never leaks internals). */
function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.message) return err.message
  if (err instanceof Error && err.message) return err.message
  return 'Could not save the change.'
}
