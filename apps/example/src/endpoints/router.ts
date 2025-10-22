import { e } from '@geekmidas/constructs/endpoints';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { EventsService } from '../services/EventsService';

export const router = e
  .logger(new ConsoleLogger())
  .services([])
  .publisher(EventsService);
