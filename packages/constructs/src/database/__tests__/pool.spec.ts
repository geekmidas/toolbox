import { EnvironmentParser } from '@geekmidas/envkit';
import {
	runWithRequestContext,
	ServiceDiscovery,
	serviceContext,
} from '@geekmidas/services';
import { Hono } from 'hono';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { HonoEndpoint } from '../../endpoints/HonoEndpointAdaptor';
import { RestApi } from '../../rest-api';
import { runShutdownHooks } from '../../shutdown';
import { KyselyDatabase } from '../kysely';
import { applicationName, closeDatabasePools } from '../pool';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;

const orders = new KyselyDatabase<Record<string, never>, 'Orders'>('Orders');

/** The construct's client, registered as a handler's would be. */
const connect = (
	construct: KyselyDatabase<any, any> = orders,
	url = URL,
): Promise<Kysely<any>> =>
	Promise.resolve(
		construct.service.register({
			envParser: new EnvironmentParser({ ORDERS_URL: url }),
			context: serviceContext,
		}),
	);

/** Asked of Postgres, not of the client: what this connection is called. */
const nameOf = async (db: Kysely<any>) => {
	const { rows } = await sql<{
		name: string;
	}>`select current_setting('application_name') as name`.execute(db);
	return rows[0]!.name;
};

/** The text of the query being run, as Postgres received it. */
const currentQuery = async (db: Kysely<any>) => {
	const { rows } = await sql<{
		q: string;
	}>`select current_query() as q`.execute(db);
	return rows[0]!.q;
};

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	trace: vi.fn(),
	child() {
		return this;
	},
};

const inRequest = <T>(
	operation: string | undefined,
	fn: () => Promise<T>,
): Promise<T> =>
	Promise.resolve(
		runWithRequestContext(
			{ logger, requestId: 'req-42', startTime: Date.now(), operation },
			fn,
		),
	);

afterEach(async () => {
	vi.unstubAllEnvs();
	ServiceDiscovery.reset();
	await closeDatabasePools();
});

describe('application_name', () => {
	it('names a Lambda connection after the function', async () => {
		vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'shop-production-createOrder');
		const db = await connect();

		expect(await nameOf(db)).toBe('shop-production-createOrder');
	});

	it('names a server connection after its app', async () => {
		vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
		vi.stubEnv('GKM_APP_NAME', 'Api');
		const db = await connect();

		expect(await nameOf(db)).toBe('Api');
	});

	it('is what pg_stat_activity shows, seen from another connection', async () => {
		vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'shop-production-listOrders');
		const db = await connect();
		const { rows } = await sql<{
			pid: number;
		}>`select pg_backend_pid() as pid`.execute(db);

		const observer = new pg.Client({ connectionString: URL });
		await observer.connect();
		try {
			const activity = await observer.query(
				'select application_name from pg_stat_activity where pid = $1',
				[rows[0]!.pid],
			);
			expect(activity.rows[0]?.application_name).toBe(
				'shop-production-listOrders',
			);
		} finally {
			await observer.end();
		}
	});

	it('gives way to PGAPPNAME', async () => {
		vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'shop-production-createOrder');
		vi.stubEnv('PGAPPNAME', 'set-by-operator');
		const db = await connect();

		expect(await nameOf(db)).toBe('set-by-operator');
	});

	it('gives way to ?application_name= in the URL', async () => {
		vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'shop-production-createOrder');
		const db = await connect(orders, `${URL}?application_name=from-url`);

		expect(await nameOf(db)).toBe('from-url');
	});

	it('reads the app from gkm dev’s tag when nothing else names it', () => {
		expect(
			applicationName({
				GKM_DEV_APP: '%2Fwork%2Fshop#web',
			} as NodeJS.ProcessEnv),
		).toBe('web');
		expect(applicationName({} as NodeJS.ProcessEnv)).toBeUndefined();
	});
});

describe('query tags', () => {
	it('ends a query run in a request with what ran it', async () => {
		const db = await connect();

		const q = await inRequest('POST /orders', () => currentQuery(db));

		expect(q).toBe(
			"select current_query() as q /*operation='POST /orders',request_id='req-42'*/",
		);
	});

	it('leaves a query run outside a request alone', async () => {
		const db = await connect();

		expect(await currentQuery(db)).toBe('select current_query() as q');
	});

	it('cannot be used to close the comment or the value', async () => {
		const db = await connect();

		const q = await inRequest("GET /x*/; drop table orders; --'", () =>
			currentQuery(db),
		);

		expect(q).toBe(
			"select current_query() as q /*operation='GET /x/ drop table orders --',request_id='req-42'*/",
		);
	});

	it('is off when the construct says so', async () => {
		const quiet = new KyselyDatabase<Record<string, never>, 'Orders'>(
			'Orders',
			{ queryTags: false },
		);
		const db = await connect(quiet);

		const q = await inRequest('POST /orders', () => currentQuery(db));

		expect(q).toBe('select current_query() as q');
	});

	it('names the endpoint a query ran for', async () => {
		const api = new RestApi('Api', { path: '.' });
		const endpoint = api
			.database(orders)
			.get('/orders/current-query')
			.output(z.object({ q: z.string() }))
			.handle(async ({ db }) => ({ q: await currentQuery(db as Kysely<any>) }));

		const discovery = ServiceDiscovery.getInstance(
			new EnvironmentParser({ ORDERS_URL: URL }),
		);
		const app = new Hono();
		HonoEndpoint.applyEventMiddleware(app, discovery);
		new HonoEndpoint(endpoint).addRoute(discovery, app);

		const response = await app.request('/orders/current-query', {
			headers: { 'X-Request-ID': 'req-7' },
		});
		const { q } = (await response.json()) as { q: string };

		expect(response.status).toBe(200);
		expect(q).toMatch(
			/ \/\*operation='GET \/orders\/current-query',request_id='req-7'\*\/$/,
		);
	});
});

describe('pool lifecycle', () => {
	it('survives the server ending an idle connection', async () => {
		const db = await connect();
		const { rows } = await sql<{
			pid: number;
		}>`select pg_backend_pid() as pid`.execute(db);

		// The connection is idle in the pool now. Ending it server-side makes
		// the pool emit 'error'; with no listener, that kills the process.
		const admin = new pg.Client({ connectionString: URL });
		await admin.connect();
		await admin.query('select pg_terminate_backend($1)', [rows[0]!.pid]);
		await admin.end();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(await nameOf(db)).toBeDefined();
	});

	it('closes every pool when the server shuts down', async () => {
		const db = await connect();
		await nameOf(db);

		await runShutdownHooks();

		await expect(nameOf(db)).rejects.toThrow(/after calling end/);
	});
});
