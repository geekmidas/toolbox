import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { InvalidClientTelemetrySampleRate } from '../clientTelemetry';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

/**
 * What the generator reads off an endpoint, as data. The builder cannot make
 * every shape the generator has to handle — an authorizer that names a type
 * but stores no scheme is how older authorizers look — so the endpoints here
 * are written out rather than built.
 */
const endpoint = (fields: Record<string, unknown>) =>
	({
		route: '/items',
		method: 'GET',
		input: {},
		...fields,
	}) as never;

const generate = (endpoints: never[], options = {}) =>
	new OpenApiTsGenerator().generate(endpoints, options);

describe('OpenApiTsGenerator', () => {
	describe('security schemes', () => {
		it.each([
			['jwt', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }],
			['bearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }],
			[
				'iam',
				{
					type: 'apiKey',
					in: 'header',
					name: 'Authorization',
					'x-amazon-apigateway-authtype': 'awsSigv4',
				},
			],
			['aws-sigv4', { type: 'apiKey', in: 'header', name: 'Authorization' }],
			['sigv4', { type: 'apiKey', in: 'header', name: 'Authorization' }],
			['apikey', { type: 'apiKey', in: 'header', name: 'X-API-Key' }],
			['api-key', { type: 'apiKey', in: 'header', name: 'X-API-Key' }],
			['oauth2', { type: 'oauth2', flows: {} }],
			['oidc', { type: 'openIdConnect', openIdConnectUrl: '' }],
			['OpenIDConnect', { type: 'openIdConnect' }],
			['custom', { type: 'http', scheme: 'bearer' }],
		])('infers a %s authorizer’s scheme from its type', async (type, scheme) => {
			const content = await generate([
				endpoint({ authorizer: { name: 'auth', type } }),
			]);

			for (const [key, value] of Object.entries(scheme)) {
				expect(content).toContain(
					`${JSON.stringify(key).replace(/^"|"$/g, '')}`,
				);
				expect(content).toContain(JSON.stringify(value).replace(/^"|"$/g, ''));
			}
			expect(content).toContain("export type SecuritySchemeId = 'auth'");
			expect(content).toContain('export function createApi');
		});

		it('prefers the scheme an authorizer stores over inference', async () => {
			const content = await generate([
				endpoint({
					authorizer: {
						name: 'partner',
						type: 'jwt',
						securityScheme: { type: 'apiKey', in: 'query', name: 'token' },
					},
				}),
			]);

			const schemes = content.slice(
				content.indexOf('export const securitySchemes'),
				content.indexOf('export type SecuritySchemeId'),
			);
			expect(schemes).toContain('type: "apiKey"');
			expect(schemes).toContain('in: "query"');
			expect(schemes).not.toContain('bearerFormat');
		});

		it('declares each scheme once, however many endpoints use it', async () => {
			const content = await generate([
				endpoint({ authorizer: { name: 'jwt', type: 'jwt' } }),
				endpoint({
					route: '/other',
					authorizer: { name: 'jwt', type: 'jwt' },
				}),
				endpoint({ route: '/admin', authorizer: { name: 'iam', type: 'iam' } }),
			]);

			expect(content).toContain("export type SecuritySchemeId = 'jwt' | 'iam'");
		});

		it('declares no scheme for an authorizer with neither a type nor a scheme', async () => {
			const content = await generate([
				endpoint({ authorizer: { name: 'mystery' } }),
			]);

			expect(content).toContain('export type SecuritySchemeId = never;');
			// The endpoint still says who authorizes it.
			expect(content).toContain(`'GET /items': "mystery"`);
		});
	});

	describe('schemas', () => {
		it('writes each JSON Schema shape as its TypeScript type', async () => {
			const content = await generate([
				endpoint({
					route: '/orders/:orderId',
					method: 'POST',
					operationId: 'createOrder',
					input: {
						params: z.object({ orderId: z.string() }),
						query: z.object({ expand: z.boolean().optional() }),
						body: z.object({
							note: z.string().nullable(),
							lines: z.array(z.object({ sku: z.string(), qty: z.number() })),
							tags: z.array(z.string()),
							meta: z.record(z.string(), z.number()),
							status: z.union([z.literal('open'), z.literal('closed')]),
							either: z.union([z.string(), z.number()]),
							both: z.intersection(
								z.object({ a: z.string() }),
								z.object({ b: z.number() }),
							),
							nothing: z.null(),
							anything: z.unknown(),
						}),
					},
					outputSchema: z.object({ id: z.string() }),
					description: 'Create an order',
					tags: ['orders'],
				}),
			]);

			// Named after the operation, with the path parameter in the path.
			expect(content).toContain("'/orders/{orderId}'");
			expect(content).toMatch(/path: \w*Params;/);
			expect(content).toMatch(/query: \w*Query;/);
			// A nullable is `type: ['string', 'null']` since Zod 4.6; it was
			// typed `unknown`.
			expect(content).toContain('note: string | null');
			expect(content).toContain('Array<');
			expect(content).toContain('Record<string, number>');
			// Literals keep their literal types; they were read as `string`.
			expect(content).toContain("status: 'open' | 'closed'");
			expect(content).toMatch(/string \| number/);
			// Zod merges an intersection of objects into one object.
			expect(content).toContain('both: { a: string; b: number }');
			expect(content).toContain('nothing: null');
		});

		it('types a literal as itself', async () => {
			const content = await generate([
				endpoint({
					outputSchema: z.object({
						one: z.literal('x'),
						three: z.literal(3),
						yes: z.literal(true),
					}),
				}),
			]);

			expect(content).toContain("one: 'x';");
			expect(content).toContain('three: 3;');
			expect(content).toContain('yes: true;');
		});

		it('marks a property optional exactly when it is not required', async () => {
			const content = await generate([
				endpoint({
					outputSchema: z.object({
						id: z.string(),
						nickname: z.string().optional(),
					}),
				}),
			]);

			expect(content).toContain('id: string;');
			expect(content).toContain('nickname?: string;');
		});

		it('types a response it cannot convert as unknown', async () => {
			// A Standard Schema from a vendor the generator has no converter for.
			const foreign = {
				'~standard': {
					version: 1,
					vendor: 'not-a-known-vendor',
					validate: (value: unknown) => ({ value }),
				},
			};

			const content = await generate([endpoint({ outputSchema: foreign })]);

			// Named in the paths, so it has to be declared — it was not, and the
			// generated client did not compile.
			expect(content).toContain("'application/json': GetItemsOutput");
			expect(content).toContain('export type GetItemsOutput = unknown;');
		});

		it('keeps the response type the endpoint declares', async () => {
			const content = await generate([
				endpoint({ outputSchema: z.string(), responseType: 'text/csv' }),
			]);

			expect(content).toContain("'text/csv':");
		});
	});

	it('carries the title, version and description it is given', async () => {
		const content = await generate([endpoint({})], {
			title: 'Orders',
			version: '2.1.0',
			description: 'Orders API',
		});

		expect(content).toContain('Orders');
		expect(content).toContain('2.1.0');
		expect(content).toContain('Orders API');
	});

	describe('trace propagation', () => {
		const authed = () => [
			endpoint({ authorizer: { name: 'auth', type: 'jwt' } }),
		];
		const open = () => [endpoint({})];

		it.each([
			['with auth', authed],
			['without auth', open],
		])('is off by default (%s)', async (_, endpoints) => {
			const content = await generate(endpoints());

			expect(content).toContain(
				'export const telemetryDefault: boolean | ClientTelemetryOptions = false;',
			);
			// The caller's own option still wins.
			expect(content).toContain(
				'telemetry: options.telemetry ?? telemetryDefault',
			);
			expect(content).toContain(
				"import type { ClientTelemetryOptions } from '@geekmidas/client/telemetry';",
			);
		});

		it('prints the default the site’s telemetry decides', async () => {
			expect(await generate(open(), { telemetry: true })).toContain(
				'export const telemetryDefault: boolean | ClientTelemetryOptions = true;',
			);
			expect(
				await generate(authed(), { telemetry: { sampleRate: 0.1 } }),
			).toContain(
				'export const telemetryDefault: boolean | ClientTelemetryOptions = { sampleRate: 0.1 };',
			);
		});

		it('refuses a rate outside 0-1', async () => {
			await expect(
				generate(open(), { telemetry: { sampleRate: 1.5 } }),
			).rejects.toThrow(InvalidClientTelemetrySampleRate);
		});
	});
});
