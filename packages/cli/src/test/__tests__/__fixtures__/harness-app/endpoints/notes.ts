import { z } from 'zod';
import { api } from '../constructs/api.js';
import { database } from '../constructs/database.js';

export const listNotes = api
	.database(database)
	.get('/notes')
	.output(z.object({ count: z.number() }))
	.handle(async () => ({ count: 0 }));
