import { useState, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import {
  PROFILE_ID_RE,
  SOUL_PRESET_LIST,
  type AvatarId,
  type SoulPresetId,
} from '@agent-deck/protocol'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { toast } from '@/lib/toast'
import { RadioCardGroup } from '@/components/ui/radio-card-group'
import { avatarForProfile } from './avatarForProfile'
import { AvatarPicker } from './AvatarPicker'
import { useCreateProfile, useWriteAvatar } from './mutations'

function canonicalizeProfileName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * NewAgentDialog — the BIRTH CEREMONY. Creating an agent is the endowment
 * moment: you name it and it is "born with a face." Built on `ui/dialog` (radix
 * focus-trap / keyboard / ARIA / reduced-motion for free — there is no Popover).
 *
 * - The name field is canonicalized like Hermes (trim + lowercase), then
 *   live-validated against the SHARED `PROFILE_ID_RE` — Create is disabled until
 *   valid and not the reserved built-in `default`.
 * - The preview `<Avatar>` re-derives deterministically from the typed name
 *   until the user picks a face (then the pick sticks). So you watch a face
 *   appear as you type — the moment that makes the agent feel like yours.
 * - ONE calm reassurance line (local, on your machine; nothing is created until
 *   you confirm). No urgency, no upsell.
 * - On confirm: POST create (+ PUT avatar when a face was explicitly chosen) →
 *   toast → navigate to the new agent's hub. Honest failure: the BFF's generic
 *   message, no fake success.
 */
export function NewAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const create = useCreateProfile()
  const writeAvatar = useWriteAvatar()
  const nameId = useId()
  const displayNameId = useId()
  const errId = useId()

  const [name, setName] = useState('')
  // An optional friendly display name shown in the UI (the chip, the tab title,
  // the hub heading). Distinct from the profile id above — blank just means "use
  // the id". Persisted after create via the avatar PUT (which carries it).
  const [displayName, setDisplayName] = useState('')
  // null = "follow the name" (deterministic preview); an id = an explicit pick.
  const [picked, setPicked] = useState<AvatarId | null>(null)
  // The starting SOUL preset. 'default' (Hermes' own seed) unless changed.
  const [soulPreset, setSoulPreset] = useState<SoulPresetId>('default')

  const trimmed = name.trim()
  const canonicalName = canonicalizeProfileName(name)
  const defaultReserved = canonicalName === 'default'
  const valid = PROFILE_ID_RE.test(canonicalName) && !defaultReserved
  const showError = trimmed.length > 0 && !valid
  // The previewed/derived face: the explicit pick, else the name-hash default.
  const previewAvatar = picked ?? avatarForProfile({ name: canonicalName || 'agent' })
  const submitting = create.isPending || writeAvatar.isPending

  function reset() {
    setName('')
    setDisplayName('')
    setPicked(null)
    setSoulPreset('default')
    create.reset()
    writeAvatar.reset()
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleCreate() {
    if (!valid || submitting) return
    try {
      // Only send a non-default preset — `default` relies on Hermes' own seed.
      await create.mutateAsync({
        name: canonicalName,
        ...(picked ? { avatar: picked } : {}),
        ...(soulPreset !== 'default' ? { soulPreset } : {}),
      })
      // Persist a chosen display name (and the resolved face it pairs with) via
      // the avatar PUT, which carries both. Only when one was actually entered —
      // a blank name leaves the agent reading by its id. A failure here is not
      // fatal: the agent already exists, so we still proceed to its hub.
      const friendly = displayName.trim()
      if (friendly) {
        try {
          await writeAvatar.mutateAsync({
            name: canonicalName,
            avatar: previewAvatar,
            displayName: friendly,
          })
        } catch {
          toast.error('Agent created, but its display name couldn’t be saved', {
            description: 'You can set it later from the agent’s identity dialog.',
          })
        }
      }
      // The birth ceremony is the success cue — it plays on the new agent's hub
      // (carried by router state), replacing a plain toast.
      handleOpenChange(false)
      navigate(`/profiles/${encodeURIComponent(canonicalName)}`, { state: { hatched: true } })
    } catch (err) {
      toast.error('Couldn’t hatch the agent', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hatch a new agent</DialogTitle>
          <DialogDescription>
            Name it, give it a face, and choose its starting soul.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
          className="grid gap-5"
        >
          {/* Profile ID → live-derived face. The preview answers "what will this be?" */}
          <div className="flex items-center gap-3.5">
            <Avatar avatarId={previewAvatar} name={trimmed || 'A'} size={56} />
            <div className="grid flex-1 gap-1.5">
              <label htmlFor={nameId} className="ad-section-label">
                Profile ID
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="researcher"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showError || undefined}
                aria-describedby={showError ? errId : `${errId}-hint`}
              />
              {!showError && (
                <p id={`${errId}-hint`} className="text-xs text-foreground-tertiary">
                  Unique id (letters, numbers, - or _; saved lowercase). Set a friendly display name
                  below.
                </p>
              )}
            </div>
          </div>

          {showError && (
            <p id={errId} role="alert" className="-mt-3 text-xs text-destructive">
              {defaultReserved ? (
                'Default is already your built-in agent.'
              ) : (
                <>
                  Use letters, numbers, <code className="font-mono">-</code> or{' '}
                  <code className="font-mono">_</code> (start with a letter or number). Saved
                  lowercase.
                </>
              )}
            </p>
          )}

          {/* Optional friendly display name — distinct from the profile id above.
              Blank just reads by the id; this can also be set/changed later from
              the agent's identity dialog. */}
          <div className="grid gap-1.5">
            <label htmlFor={displayNameId} className="ad-section-label">
              Display name <span className="font-normal text-foreground-tertiary">(optional)</span>
            </label>
            <Input
              id={displayNameId}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={canonicalName || 'Researcher'}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
          </div>

          <div className="grid gap-2">
            <span className="ad-section-label">Face</span>
            <AvatarPicker
              value={previewAvatar}
              name={displayName.trim() || canonicalName || 'agent'}
              onChange={setPicked}
            />
          </div>

          {/* Starting soul — a preset personality, written to SOUL.md on hatch and
              fully editable afterward (the agent's Soul tab). */}
          <div className="grid gap-2">
            <span className="ad-section-label">Starting soul</span>
            <SoulPresetPicker value={soulPreset} onChange={setSoulPreset} />
            <p className="text-xs leading-relaxed text-foreground-tertiary">
              A starting personality. Edit it any time from the agent&apos;s Soul tab.
            </p>
          </div>

          {/* ONE calm reassurance line — local, reversible, no urgency. */}
          <p className="text-xs leading-relaxed text-foreground-tertiary">
            Created locally on your machine. Nothing happens until you confirm.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              Hatch agent
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * SoulPresetPicker — choose the new agent's starting personality. Delegates to
 * RadioCardGroup for consistent ARIA, roving keys, and neutral identity ring.
 */
function SoulPresetPicker({
  value,
  onChange,
}: {
  value: SoulPresetId
  onChange: (id: SoulPresetId) => void
}) {
  return (
    <RadioCardGroup
      value={value}
      onValueChange={onChange}
      options={SOUL_PRESET_LIST.map((p) => ({ value: p.id, label: p.label, description: p.blurb }))}
      aria-label="Choose a starting soul"
      className="grid-cols-2"
    />
  )
}
