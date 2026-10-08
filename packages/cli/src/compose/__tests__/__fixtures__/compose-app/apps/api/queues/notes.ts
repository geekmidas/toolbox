import { sql } from 'kysely';
import { z } from 'zod';
import { worker } from '../../../constructs/worker.js';

/** Writes each note it is sent — in the worker's container, not the API's. */
export const notes = worker
	.queue('Notes')
	.message(z.object({ id: z.string(), body: z.string() }))
	.handle(async ({ messages, db, logger }) => {
		for (const { id, body } of messages) {
			await sql`insert into notes (id, body) values (${id}, ${body}) on conflict (id) do nothing`.execute(
				db as never,
			);
			logger.info({ id }, 'Wrote a note');
		}
	});
