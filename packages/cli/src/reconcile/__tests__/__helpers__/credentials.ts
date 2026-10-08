import { LOCAL_LOGS_EMAIL } from '../../../compose/logs';
import { EMULATOR_ACCESS_KEY_ID } from '../../emulator';
import type { LocalCredentials } from '../../localCredentials';

/**
 * A workspace's local logins, fixed so a URL or a compose file can be
 * asserted to the character. Real runs generate theirs — see
 * `localCredentials.ts`.
 */
export const TEST_CREDENTIALS: LocalCredentials = Object.freeze({
	seed: 'test-seed',
	postgres: { user: 'shop_admin', password: 'pg-secret' },
	minio: { user: 'minio', password: 'minio-secret-0123' },
	rabbitmq: { user: 'rabbitmq', password: 'rabbit-secret' },
	redis: { password: 'redis-secret' },
	cacheToken: 'cache-token',
	emulator: {
		accessKeyId: EMULATOR_ACCESS_KEY_ID,
		secretAccessKey: 'emulator-secret',
	},
	logs: { email: LOCAL_LOGS_EMAIL, password: 'Logs-secret-1' },
});
