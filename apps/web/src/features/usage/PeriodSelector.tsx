/**
 * Period selector — the 7 / 14 / 30 day window switch, a thin wrapper over the
 * shared SegmentedControl (hairline pill, amber active segment, the roving-
 * tabindex radiogroup keyboard map). Disabled while a fresh range loads.
 */
import { SegmentedControl } from '@/components/ui/segmented-control'
import { USAGE_PERIODS, type UsagePeriod } from './types'

export interface PeriodSelectorProps {
  value: UsagePeriod
  onChange: (period: UsagePeriod) => void
  disabled?: boolean
}

const PERIOD_OPTIONS = USAGE_PERIODS.map((p) => ({ value: p, label: `${p}d` }))

export function PeriodSelector({ value, onChange, disabled }: PeriodSelectorProps) {
  return (
    <SegmentedControl<UsagePeriod>
      aria-label="Usage period"
      options={PERIOD_OPTIONS}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    />
  )
}
