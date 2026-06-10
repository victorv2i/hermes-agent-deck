/**
 * Jobs (cron) surface types — re-exported from the shared protocol so the surface
 * and the BFF speak ONE contract (packages/protocol/src/cron.ts). No surface-local
 * widening: the wire shape is the source of truth.
 */
export type {
  CronJob,
  CronJobList,
  CronSchedule,
  CronScheduleKind,
  CronJobStatus,
  CronJobCreateInput,
  CronJobUpdateInput,
} from '@agent-deck/protocol'
