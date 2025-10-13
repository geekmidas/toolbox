import { e } from '@geekmidas/api/server';
import { EventsService } from '../services/EventsService';

export const router = e.publisher(EventsService);
