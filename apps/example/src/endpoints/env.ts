import { z } from 'zod';
import { envParser } from '../config/env';
import { router } from './router';

/**
 * Example endpoint demonstrating access to shared services, database, and auditor.
 * All are inherited from the router configuration.
 */
export const geEnvironment = router
	.get('/env')

	.output(z.string().array())
	.handle(async ({ services, logger, db, auditor }) => {
		const config = envParser
			.create((g) => ({
				test: g('TEST_VAR').string(),
			}))
			.parse();

		return [['TEST_VAR', config.test].join(',')];
	});
