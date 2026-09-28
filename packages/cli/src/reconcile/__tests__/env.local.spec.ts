import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { portKeys } from '../containers';
import { envFor, UnprovisionedEventsBackend } from '../env';
import { type PlanOptions, planFor } from '../plan';

/**
 * The local values that are not an address: a secret the platform owns, the
 * `roles: false` downgrade, and the one backend the local target refuses.
 */

function resolve(
	manifest: ConstructManifest,
	stage = 'dev',
	options: PlanOptions & { project?: string } = {},
) {
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: 'dev',
		...options,
	});
	const ports = Object.fromEntries(
		portKeys(plan.containers).map((key, i) => [key, 21000 + i]),
	);

	return envFor(plan, {
		ports,
		...(options.project ? { project: options.project } : {}),
	});
}

describe('a declared secret, locally', () => {
	const manifest = {
		Signing: { kind: 'secret', id: 'Signing', provides: ['SIGNING'] },
	} as const satisfies ConstructManifest;

	it('is stable, and never the same across stages or projects', () => {
		const one = resolve(manifest, 'dev', { project: 'shop' }).SIGNING;

		expect(one).toMatch(/^[\w-]{43}$/);
		expect(resolve(manifest, 'dev', { project: 'shop' }).SIGNING).toBe(one);
		expect(resolve(manifest, 'test', { project: 'shop' }).SIGNING).not.toBe(
			one,
		);
		expect(resolve(manifest, 'dev', { project: 'blog' }).SIGNING).not.toBe(one);
	});
});

describe('a database without its own roles', () => {
	const manifest = {
		Orders: {
			kind: 'database',
			id: 'Orders',
			roles: false,
			provides: ['ORDERS_URL'],
		},
	} as const satisfies ConstructManifest;

	it('connects as the cluster’s own credential, with no schema to pin', () => {
		const url = new URL(resolve(manifest).ORDERS_URL!);

		expect(url.username).toBe('geekmidas');
		expect(url.pathname).toBe('/orders');
		expect(url.search).toBe('');
	});
});

describe('events on SNS, locally', () => {
	const manifest = {
		Emails: {
			kind: 'queue',
			id: 'Emails',
			worker: {
				id: 'EmailsWorker',
				handler: 'emails.handler',
				dependencies: [],
			},
			provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
		},
	} as const satisfies ConstructManifest;

	it('is refused, naming the backends that work', () => {
		expect(() => resolve(manifest, 'dev', { events: 'sns' })).toThrow(
			UnprovisionedEventsBackend,
		);
		expect(() => resolve(manifest, 'dev', { events: 'sns' })).toThrow(
			"Use 'pgboss' (the default) or 'rabbitmq'",
		);
	});
});
