import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.js';

/**
 * The application's own HTTP surface.
 *
 * Declaring it is what turns three hand-maintained lists into one edge each:
 * the CORS origins this API accepts, the origins the auth server trusts, and
 * the domain a session cookie is scoped to. None of the three is written down
 * anywhere any more — they are read off whatever declares an edge to a surface,
 * which is the only place that information was ever true.
 *
 * `default: 'none'` is typed out rather than omitted. An API that ships open
 * because a field was left off is the one default worth refusing to have, so
 * public-by-default has to be a sentence someone wrote.
 *
 * `.auth(auth)` rather than `.calls([auth])`: what authenticates a surface is a
 * different fact from what it happens to call, and it is the one that decides
 * what a request is allowed to be. It records the edge either way — the auth
 * server learns this origin, and the two share a cookie domain — but it says
 * which relationship it is.
 */
export const api = new RestApi('Api', {
	authorizers: ['iam'],
	default: 'none',
	// Only what a graph cannot answer. The *origins* are not here — they are read
	// off whatever declared an edge to this surface, which is the whole reason
	// the edge exists.
	cors: { maxAge: 3600 },

	// The app that serves it. Where its source lives and which globs find its
	// code is the half of an application no graph can derive — it is a fact
	// about a directory. It used to live in `gkm.config.ts` under `apps.api`,
	// beside a `path` and a `port` that the declaration already implied, which
	// meant the same app was described twice and only one copy was checked.
	app: {
		path: 'apps/api',

		// Discovery is glob-driven: an endpoint outside these never loads, and
		// nothing will tell you at runtime that it is missing.
		routes: './endpoints/**/*.ts',
		functions: './functions/**/*.ts',
		crons: './crons/**/*.ts',
		subscribers: './subscribers/**/*.ts',
		queues: './queues/**/*.ts',

		envParser: './config/env#envParser',
		logger: './config/logger',
		telescope: './config/telescope#telescope',
		studio: './config/studio#studio',
		openapi: true,
		runtime: 'node',
		env: ['.env', '.env.example'],
	},
}).auth(auth);
