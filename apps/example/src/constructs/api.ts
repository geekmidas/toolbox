import { RestApi } from '@geekmidas/constructs/rest-api';
import logger from '../config/logger.js';

/**
 * The application's HTTP surface.
 *
 * It carries what the *process* is — the logger every endpoint runs with, and
 * the environment parser its adaptors resolve services through. Both used to be
 * named in config as module paths, because the build wrote an import for each
 * into every generated handler and a generator can print a specifier but not an
 * object. An endpoint built from the surface already holds them.
 *
 * It deliberately does not carry `dependsOn`, `database`, `auditor` or
 * `publisher`. Those inject a client into a handler, so putting one here would
 * hand it to every route the surface serves. They belong to an endpoint, or to
 * a factory branched from `api.endpoints` for a group that shares them — see
 * `endpoints/router.ts`.
 */
export const api = new RestApi('Api', {
	default: 'none',
	logger,
});
