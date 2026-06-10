import { BUILTIN_AVATAR_IDS, type AvatarId } from '@agent-deck/protocol'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/**
 * AvatarPicker — the keyboard/SR-navigable grid for choosing an agent's face.
 *
 * A real ARIA `radiogroup`: arrow keys move (native radio roving focus), Space/
 * Enter selects, and each face is a labeled `<Avatar>` ("Face 3 of 3"). The
 * SELECTED tile gets the IDENTITY ring `var(--border-strong)` — NEVER `--ring`
 * (byte-identical to the amber action accent) — so picking a face never lights
 * up the action color. Amber lives only on the dialog's Confirm button.
 */
export function AvatarPicker({
  value,
  onChange,
  name,
  className,
}: {
  /** The currently selected avatar id. */
  value: AvatarId
  onChange: (id: AvatarId) => void
  /** The agent name (drives each tile's lettermark fallback). */
  name: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Choose a face"
      className={cn('flex flex-wrap gap-2.5', className)}
    >
      {BUILTIN_AVATAR_IDS.map((id, i) => {
        const selected = id === value
        return (
          <label key={id} className="relative cursor-pointer" title={`Face ${i + 1}`}>
            <input
              type="radio"
              name="agent-avatar"
              value={id}
              checked={selected}
              onChange={() => onChange(id)}
              className="peer sr-only"
              aria-label={`Face ${i + 1} of ${BUILTIN_AVATAR_IDS.length}`}
            />
            <span
              className={cn(
                'block rounded-full p-0.5 transition-[box-shadow,background-color]',
                // IDENTITY ring on the chosen face — border-strong, never --ring.
                selected
                  ? 'ring-2 ring-[var(--border-strong)] ring-offset-2 ring-offset-popover'
                  : 'ring-0 hover:bg-surface-2',
                // The keyboard focus ring stays the governed --ring (focus only).
                // It's a native outline, NOT the box-shadow ring, so on a tile
                // that's BOTH selected and focused the identity ring underneath
                // stays legible (the outline sits outside it rather than masking).
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--ring)]',
              )}
            >
              <Avatar avatarId={id} name={name} size={44} label={`Face ${i + 1}`} />
            </span>
          </label>
        )
      })}
    </div>
  )
}
