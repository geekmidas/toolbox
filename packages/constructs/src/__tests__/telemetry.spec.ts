import {
	dependenciesOf,
	dependentsOf,
	PUBLIC,
	publicEnvFor,
} from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { BetterAuth } from '../auth';
import { KyselyDatabase } from '../database/kysely';
import { RestApi } from '../rest-api';
import { StaticSite } from '../site';
import { Telemetry } from '../telemetry';
import { Worker } from '../worker';

/** Every declaration of the constructs, keyed by id — what discovery builds. */
function manifestOf(...constructs: { declare(): { id: string }[] }[]) {
	return Object.fromEntries(
		constructs.flatMap((c) => c.declare()).map((d) => [d.id, d]),
	) as never;
}

const OTEL_KEYS = [
	'OTEL_EXPORTER_OTLP_ENDPOINT',
	'OTEL_EXPORTER_OTLP_HEADERS',
	'OTEL_SERVICE_NAME',
	'OTEL_TRACES_SAMPLER',
	'OTEL_TRACES_SAMPLER_ARG',
];

describe('Telemetry', () => {
	it('declares a node providing OpenTelemetry’s own keys, and nothing about where they go', () => {
		const telemetry = new Telemetry('Telemetry', {
			ignorePaths: ['/health', '/ready'],
			attributes: { 'service.namespace': 'shop' },
		});

		expect(telemetry.declare()).toEqual([
			{
				kind: 'telemetry',
				id: 'Telemetry',
				ignorePaths: ['/health', '/ready'],
				attributes: { 'service.namespace': 'shop' },
				provides: OTEL_KEYS,
			},
		]);
	});

	it('leaves out what it was not given', () => {
		expect(new Telemetry('telemetry').declare()).toEqual([
			{ kind: 'telemetry', id: 'Telemetry', provides: OTEL_KEYS },
		]);
	});

	it('is never part of a site’s public values', () => {
		expect(PUBLIC.telemetry).toEqual([]);
	});
});

describe('Telemetry edges', () => {
	const telemetry = new Telemetry('Telemetry');
	const database = new KyselyDatabase('Database');
	const authDb = database.schema('AuthDb');

	it('is an edge from a RestApi that is given it, like its logger', () => {
		const api = new RestApi('Api', {
			path: 'apps/api',
			defaultAuthorizer: 'none',
			telemetry,
		});
		const [declaration] = api.declare();

		expect(declaration).toMatchObject({
			kind: 'rest-api',
			telemetry: 'Telemetry',
		});
		expect(dependenciesOf(declaration!)).toContainEqual({
			target: 'Telemetry',
			kind: 'telemetry',
		});
		expect(api.telemetry).toBe(telemetry);
	});

	it('is no edge from a RestApi that is not given it', () => {
		const [declaration] = new RestApi('Api', {
			path: 'apps/api',
			defaultAuthorizer: 'none',
		}).declare();

		expect(declaration).not.toHaveProperty('telemetry');
		expect(dependenciesOf(declaration!)).toEqual([]);
	});

	it('is an edge from a Worker, a BetterAuth server and a site', () => {
		const worker = new Worker('Jobs', { telemetry });
		const auth = new BetterAuth('Auth', {
			path: 'apps/auth',
			database: authDb,
			telemetry,
		});
		const web = new StaticSite('Web', { path: 'apps/web', telemetry });

		const manifest = manifestOf(telemetry, database, worker, auth, web);

		expect(dependentsOf(manifest, 'Telemetry')).toEqual([
			'Auth',
			'Jobs',
			'Web',
		]);
		expect(manifest).toMatchObject({
			Jobs: { kind: 'worker', telemetry: 'Telemetry' },
			Auth: { kind: 'rest-api', telemetry: 'Telemetry' },
			Web: { kind: 'site', telemetry: 'Telemetry' },
		});
	});

	it('inlines none of its keys into a site that uses it', () => {
		const api = new RestApi('Api', {
			path: 'apps/api',
			defaultAuthorizer: 'none',
			telemetry,
		});
		const web = new StaticSite('Web', {
			path: 'apps/web',
			telemetry,
		}).dependsOn([api]);
		const manifest = manifestOf(telemetry, api, web);

		const inlined = publicEnvFor(manifest.Web, manifest);

		// The API's address, as before — and no OTEL_* under any prefix.
		expect(inlined).toEqual({ VITE_API_URL: 'API_URL' });
		for (const [name, source] of Object.entries(inlined)) {
			expect(name).not.toMatch(/OTEL_/);
			expect(source).not.toMatch(/OTEL_/);
		}
	});
});
