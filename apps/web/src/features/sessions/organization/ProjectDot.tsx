import { projectColorVar } from './projectPalette'

/**
 * The colored dot that identifies a project at a glance. Its hue comes from the
 * curated CATEGORICAL palette (a `var(--cat-…)` reference), the design
 * language's allowed data-grouping exception — never the sky-blue action accent.
 * Decorative by default (the project name carries the meaning); pass a `label`
 * only where the dot stands alone.
 */
export function ProjectDot({ color, label }: { color: string; label?: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: projectColorVar(color) }}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      title={label}
    />
  )
}
