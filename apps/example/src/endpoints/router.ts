import { e } from '@geekmidas/constructs/endpoints';
import { EventsService } from '../services/EventsService';

export const router = e.publisher(EventsService);
