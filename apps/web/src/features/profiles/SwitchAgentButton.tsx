import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { GatewayRestartCard } from './GatewayRestartCard'
import { useSwitchProfile, switchAppliedLine, SWITCH_RESTART_NOTE } from './mutations'

/**
 * SwitchAgentButton — the ONE honest switch affordance (Agents hub list + detail).
 *
 * Calls `POST /profiles/switch` (writes `active_profile` atomically) and then —
 * crucially — shows the VERBATIM honest state plus a real browser restart
 * action. The switch is not called "live" until the re-probed gateway state
 * reports back.
 */
export function SwitchAgentButton({
  name,
  size = 'sm',
  className,
  onApplied,
}: {
  name: string
  size?: 'sm' | 'default'
  className?: string
  /** Fired once the switch is applied, so a parent can keep this affordance
   * mounted even after its own `isActive` gate flips (the roster reports this
   * agent active the moment `active_profile` is written, BEFORE the gateway
   * restart that actually applies it). Without this the restart card unmounts. */
  onApplied?: () => void
}) {
  const switchProfile = useSwitchProfile()
  const [applied, setApplied] = useState(false)

  async function handleSwitch() {
    try {
      await switchProfile.mutateAsync(name)
      setApplied(true)
      onApplied?.()
    } catch (err) {
      toast.error('Couldn’t set the active agent', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  if (applied) {
    return (
      <GatewayRestartCard
        message={switchAppliedLine(name)}
        note={SWITCH_RESTART_NOTE}
        className={className}
      />
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={handleSwitch}
      disabled={switchProfile.isPending}
      className={className}
    >
      <ArrowLeftRight aria-hidden />
      Switch to this agent
    </Button>
  )
}
