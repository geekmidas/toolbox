import { sql } from 'kysely';
import { z } from 'zod';
import { api } from '../../../constructs/api.js';
import { database } from '../../../constructs/database.js';

/** A query through the database the surface was branched with. */
export const databaseCheck = api
	.database(database)
	.get('/database')
	.output(z.object({ answer: z.number() }))
	.handle(async ({ db }) => {
		const { rows } = await sql<{ answer: number }>`select 42 as answer`.execute(
			db,
		);
		return rows[0]!;
	});
