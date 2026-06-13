import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { type GkmLinkable, ResourceType } from '../Linkable';
import { LinkedEnvironment } from '../LinkedEnvironment';

// App/Stack are runtime-pure (they reference SST only via erased type
// annotations), so they can be constructed directly in tests.
const stack = new App({
	name: 'my-app',
	stage: 'prod',
	domain: 'example.com',
	hostedZoneId: 'Z123',
	region: 'us-east-1',
}).stack('api');

const db: GkmLinkable = { _id: 'db', _type: ResourceType.Postgres };
const uploads: GkmLinkable = { _id: 'uploads', _type: ResourceType.Bucket };

describe('LinkedEnvironment', () => {
	describe('createBaseEnvironment', () => {
		it('builds the stack env defaults (no SERVICE_NAME without a name)', () => {
			expect(LinkedEnvironment.createBaseEnvironment(stack)).toEqual({
				NODE_ENV: 'production',
				STAGE: 'prod',
				REGION: 'us-east-1',
				APP_NAME: 'my-app',
			});
		});

		it('adds SERVICE_NAME when a service name is given', () => {
			const env = LinkedEnvironment.createBaseEnvironment(stack, 'processor');
			expect(env.SERVICE_NAME).toBe('processor');
			expect(env.APP_NAME).toBe('my-app');
		});
	});

	describe('validation', () => {
		const linked = new LinkedEnvironment([db, uploads], {
			whitelist: ['APP_NAME'],
			context: 'orders-fn',
		});

		it('exposes link-derived vars, the platform whitelist, and extras', () => {
			expect(linked.validator.has('DB_HOST')).toBe(true);
			expect(linked.validator.has('UPLOADS_NAME')).toBe(true);
			expect(linked.validator.has('AWS_REGION')).toBe(true); // platform: aws
			expect(linked.validator.has('APP_NAME')).toBe(true); // extra whitelist
			expect(linked.validator.has('NOPE')).toBe(false);
		});

		it('validates required vars against the links', () => {
			expect(linked.validator.validate(['DB_HOST', 'APP_NAME']).valid).toBe(
				true,
			);
			expect(linked.validator.validate(['MISSING_ONE']).valid).toBe(false);
		});
	});

	describe('resolveLink (least privilege)', () => {
		const linked = new LinkedEnvironment([db, uploads], {
			whitelist: [],
		});

		it('attaches only the links that provide a requested var', () => {
			expect(linked.resolveLink(['DB_HOST'])).toEqual([db]);
		});

		it('attaches multiple links when several are needed', () => {
			expect(linked.resolveLink(['DB_URL', 'UPLOADS_NAME'])).toEqual([
				db,
				uploads,
			]);
		});

		it('attaches nothing for a non-link (e.g. platform) var', () => {
			expect(linked.resolveLink(['AWS_REGION'])).toEqual([]);
		});
	});
});
