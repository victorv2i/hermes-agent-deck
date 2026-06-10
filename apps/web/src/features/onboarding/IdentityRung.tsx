import { useId, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Loader2 } from 'lucide-react'
import {
  SOUL_PRESET_LIST,
  SOUL_PRESETS,
  type AvatarId,
  type SoulPresetId,
} from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { writeProfileFile } from '@/features/memory/api'
import { avatarForProfile } from '@/features/profiles/avatarForProfile'
import { AvatarPicker } from '@/features/profiles/AvatarPicker'
import { HatchCeremony } from '@/features/profiles/HatchCeremony'
import { useWriteAvatar } from '@/features/profiles/mutations'
import { RungChrome } from './RungChrome'

/**
 * Rung 3 — Identity. REUSES the live ceremony primitives (the `AvatarPicker`,
 * `avatarForProfile`, `useWriteAvatar` — the SAME 8 avatars + identity-ring
 * picker as the Agents hub) to endow the DEFAULT agent with a face AND name.
 * Writing the avatar persists `<default>/.agent-deck/identity.json` with both
 * `avatar` and `displayName`, which is exactly what the `agentNamed` probe
 * checks — so the rung completes on the REAL write, never a remembered flag.
 *
 * The typed name is persisted as `displayName` in identity.json and surfaced
 * everywhere the agent name appears (ChatHeader, Home hero, run notifications).
 * Empty name → no displayName written; the UI falls back to the real name "default".
 *
 * The birth moment: when the face is saved, the SAME `HatchCeremony` the Agents
 * hub plays blooms here too — the one place a non-technical first-runner sees
 * their agent come to life — then it advances to the first chat.
 *
 * Starting soul (optional): a preset personality. "Hermes default" writes
 * NOTHING (stock create already seeded it — honest, no overwrite); any other
 * preset is written to the default agent's SOUL.md via the same `/soul` route
 * the Soul tab uses, and stays fully editable afterward.
 */
export function IdentityRung({
  named,
  onContinue,
  onBack,
  onSkip,
}: {
  named: boolean
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const writeAvatar = useWriteAvatar()
  const nameId = useId()

  const [name, setName] = useState('')
  const [picked, setPicked] = useState<AvatarId | null>(null)
  const [soulPreset, setSoulPreset] = useState<SoulPresetId>('default')
  // The just-born agent the ceremony celebrates; null until the face is saved.
  const [born, setBorn] = useState<{ name: string; avatar: AvatarId } | null>(null)

  const trimmed = name.trim()
  // The previewed face: an explicit pick, else a STABLE default face. (It used to
  // be a name-hash that changed on every keystroke — confusing, so it's fixed now;
  // the face only changes when you pick one.)
  const previewAvatar = picked ?? avatarForProfile({ name: 'default' })
  const saving = writeAvatar.isPending

  async function endow() {
    if (saving) return
    try {
      // Write to the EXISTING default profile — this creates the agent-deck
      // identity.json (the agentNamed probe) with the face AND the optional nickname
      // (displayName). It never creates/replaces the agent. The gate's next poll
      // flips the rung complete.
      await writeAvatar.mutateAsync({
        name: 'default',
        avatar: previewAvatar,
        displayName: trimmed || undefined,
      })
      // Born with a soul: only a NON-default preset is written (default is already
      // seeded by stock Hermes — overwriting it would drift). Best-effort: the
      // face + name are already saved, so a soul hiccup never blocks the birth.
      if (soulPreset !== 'default' && !SOUL_PRESETS[soulPreset].seededByHermes) {
        try {
          await writeProfileFile('default', 'soul', SOUL_PRESETS[soulPreset].soul)
        } catch (err) {
          toast.error("Saved the face, but couldn't set the starting soul", {
            description:
              err instanceof Error
                ? `${err.message} You can set it any time from the agent's Soul tab.`
                : "You can set it any time from the agent's Soul tab.",
          })
        }
      }
      // Play the birth moment, then advance. The ceremony is the success cue —
      // it replaces the old toast. With no nickname, the agent keeps its real
      // name "default" (never a fabricated "Your agent").
      setBorn({ name: trimmed || 'default', avatar: previewAvatar })
    } catch (err) {
      toast.error("Couldn't save the identity", {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  // The birth moment — reuses the Agents-hub ceremony (accessible, reduced-motion
  // safe, click/Escape dismissible). On done, advance to the first chat.
  if (born) {
    return <HatchCeremony name={born.name} avatar={born.avatar} onDone={onContinue} />
  }

  // Already endowed (e.g. resumed past this rung): show the honest done state.
  if (named) {
    return (
      <RungChrome
        rung="identity"
        onBack={onBack}
        onSkip={onSkip}
        primary={
          <Button type="button" onClick={onContinue} className="h-11 rounded-xl px-5 text-[15px]">
            Continue
          </Button>
        }
      >
        <div
          role="status"
          className="ad-surface flex items-center gap-2.5 rounded-md bg-surface-1 px-3 py-2.5 text-sm"
        >
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <span className="text-foreground">Your agent already has a face.</span>
        </div>
      </RungChrome>
    )
  }

  return (
    <RungChrome
      rung="identity"
      onBack={onBack}
      onSkip={onSkip}
      primary={
        <Button
          type="button"
          onClick={endow}
          disabled={saving}
          className="h-11 rounded-xl px-5 text-[15px]"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Save &amp; continue
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void endow()
        }}
        className="grid gap-4"
      >
        <div className="flex items-center gap-3.5">
          <Avatar avatarId={previewAvatar} name={trimmed || 'A'} size={56} />
          <div className="grid flex-1 gap-1.5">
            <label htmlFor={nameId} className="ad-section-label">
              Nickname (optional)
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mercury, or leave blank"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs leading-snug text-foreground-tertiary">
              Shown in the app. Your agent’s name stays “default”.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <span className="ad-section-label">Face</span>
          <AvatarPicker value={previewAvatar} name="default" onChange={setPicked} />
        </div>

        <div className="grid gap-2">
          <span className="ad-section-label">Personality</span>
          <SoulPresetPicker value={soulPreset} onChange={setSoulPreset} />
          {soulPreset === 'default' ? (
            <p className="text-xs leading-relaxed text-foreground-tertiary">
              “Hermes Default” keeps your agent’s current personality, no change. The other presets
              replace it.
            </p>
          ) : (
            <p
              role="alert"
              data-testid="soul-replace-warning"
              className="ad-surface flex items-start gap-2 rounded-md bg-surface-1 px-3 py-2 text-xs leading-relaxed text-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                This <strong>replaces</strong> your default agent’s current personality (
                <code>SOUL.md</code>). You can change it later from the Soul tab.
              </span>
            </p>
          )}
        </div>
      </form>
    </RungChrome>
  )
}

/**
 * SoulPresetPicker — choose the default agent's starting personality. A real
 * ARIA radiogroup of preset tiles (label + one-line blurb). Selection uses the
 * IDENTITY ring (`--border-strong`) + a faint surface, never the action accent;
 * only the small "selected" check is the accent (an active-state marker). The
 * chosen preset's SOUL.md template is written on confirm and stays editable.
 */
function SoulPresetPicker({
  value,
  onChange,
}: {
  value: SoulPresetId
  onChange: (id: SoulPresetId) => void
}) {
  return (
    <div role="radiogroup" aria-label="Choose a personality" className="grid grid-cols-2 gap-2">
      {SOUL_PRESET_LIST.map((preset) => {
        const selected = preset.id === value
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(preset.id)}
            className={cn(
              'flex flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none',
              'focus-visible:ad-focus',
              selected
                ? 'border-[var(--border-strong)] bg-muted/50'
                : 'border-border hover:border-[var(--border-strong)] hover:bg-muted/30',
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {preset.label}
              {selected && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
            </span>
            <span className="text-xs leading-snug text-foreground-tertiary">{preset.blurb}</span>
          </button>
        )
      })}
    </div>
  )
}
