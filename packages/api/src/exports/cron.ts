import { CronBuilder } from '../constructs/Cron';

/**
 * The default cron builder for creating scheduled functions
 */
export const cron = new CronBuilder();

export { Cron, CronBuilder } from '../constructs/Cron';
export type {
  ScheduleExpression,
  CronExpression,
  RateExpression,
} from '../constructs/Cron';
