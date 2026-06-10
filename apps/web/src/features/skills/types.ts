/**
 * Feature-local contract for the Skills surface. Kept feature-local (the web app
 * carries no zod dependency) and mirrors the BFF shape from
 * `apps/server/src/skills/skillsClient.ts` / `packages/protocol/src/skills.ts`.
 *
 * The Skills page lists every installed skill, lets the operator filter by
 * category + search, and enable/disable a skill (the surface's one mutation).
 */

/** One installed skill as rendered on the Skills page. */
export interface Skill {
  /** Skill identifier. */
  name: string
  /** One-line description. */
  description: string
  /** Category the skill lives under, or null for an uncategorized skill. */
  category: string | null
  /** Whether the skill is currently enabled. */
  enabled: boolean
  /**
   * On-disk directory path RELATIVE to the skills root (e.g. `creative/ascii-art`),
   * or null when it could not be resolved on disk. Drives edit/delete — a null
   * path means edit/delete are honestly unavailable for that row.
   */
  path: string | null
}

/** A skill's editable SKILL.md body + presence + whether linked files exist. */
export interface SkillBody {
  /** The relative skill path this body belongs to. */
  path: string
  /** SKILL.md content, or '' when absent. */
  content: string
  /** Whether SKILL.md exists on disk. */
  exists: boolean
  /**
   * Whether the skill carries files OTHER than SKILL.md (README, scripts/, …).
   * This surface edits only the primary body; the UI notes the rest is out of scope.
   */
  hasExtraFiles: boolean
}

/** The Skills list response from the BFF. */
export interface SkillsResponse {
  skills: Skill[]
}
