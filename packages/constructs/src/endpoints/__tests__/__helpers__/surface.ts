import type { EndpointSurface } from '../../Endpoint';
import { defaultEnvParser } from '../../surfaceEnv';

/**
 * The surface these specs build endpoints from.
 *
 * Every endpoint has one — a factory exists to build endpoints *for* a surface,
 * and one without it has no logger, no environment parser and nothing to
 * attribute its traffic to. That was survivable only while a bare `e` existed;
 * these specs constructed factories the same way it did.
 */
export const TEST_SURFACE: EndpointSurface = {
	id: 'Test',
	envParser: defaultEnvParser(),
};
