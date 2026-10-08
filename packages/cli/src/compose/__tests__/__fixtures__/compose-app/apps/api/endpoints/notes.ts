import { NotFoundError } from '@geekmidas/errors';
import { sql } from 'kysely';
import { z } from 'zod';
import { api } from '../../../constructs/api.js';
import { database } from '../../../constructs/database.js';
import { notes } from '../queues/notes.js';

/** Sends a note to the worker, which writes it. */
export const sendNote = api
	.post('/notes')
	.dependsOn([notes])
	.body(z.object({ id: z.string(), body: z.string() }))
	.output(z.object({ queued: z.boolean() }))
	.handle(async ({ body, services }) => {
		await services.notes.publish([{ type: 'Notes', payload: body }]);
		return { queued: true };
	});

/** A note the worker wrote, read back. */
export const readNote = api
	.database(database)
	.get('/notes/:id')
	.params(z.object({ id: z.string() }))
	.output(z.object({ id: z.string(), body: z.string() }))
	.handle(async ({ params, db }) => {
		const { rows } = await sql<{
			id: string;
			body: string;
		}>`select id, body from notes where id = ${params.id}`.execute(db as never);
		const [note] = rows;
		if (!note) throw new NotFoundError('No such note yet');
		return note;
	});
