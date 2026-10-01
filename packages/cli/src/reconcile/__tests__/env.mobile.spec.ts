import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { portKeys } from '../containers';
import { envFor } from '../env';
import { lanAddress } from '../lan';
import { planFor } from '../plan';

/**
 * A browser and a phone calling the same two surfaces: what the local target
 * resolves differs only where a phone cannot do what a browser does.
 */
const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
		endpoints: [],
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
		endpoints: [],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'next',
		app: { path: 'apps/web' },
		dependencies: [
			{ target: 'Api', kind: 'rest-api' },
			{ target: 'Auth', kind: 'rest-api' },
		],
		provides: ['WEB_URL'],
	},
	App: {
		kind: 'mobile-app',
		id: 'App',
		flavour: 'expo',
		app: { path: 'apps/app' },
		dependencies: [
			{ target: 'Api', kind: 'rest-api' },
			{ target: 'Auth', kind: 'rest-api' },
		],
		provides: ['APP_SCHEME'],
	},
} as const satisfies ConstructManifest;

const LAN = '192.168.1.20';
const addresses = {
	Api: 'http://localhost:3000',
	Auth: 'http://localhost:3001',
	Web: 'http://localhost:3002',
};

/** `null` for a machine on no network. */
const env = (lan: string | null = LAN) => {
	const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
		localStage: 'dev',
	});
	const ports = Object.fromEntries(
		portKeys(plan.containers).map((key, index) => [key, 28000 + index]),
	);
	return envFor(plan, {
		ports,
		project: 'beetlefit',
		addresses,
		...(lan ? { lanAddress: lan } : {}),
	});
};

describe('a mobile app on a local stage', () => {
	it('answers on its scheme, suffixed with the stage', () => {
		expect(env().APP_SCHEME).toBe('beetlefit-dev');
	});

	it('is built with each surface’s own port, which a phone can reach', () => {
		// The browser gets the edge's hostname; a phone cannot resolve it, and
		// the edge routes by it, so the app gets the port it swaps a host into.
		const resolved = env();
		expect(resolved.EXPO_PUBLIC_API_URL).toBe('http://localhost:3000');
		expect(resolved.EXPO_PUBLIC_AUTH_URL).toBe('http://localhost:3001');
		expect(resolved.NEXT_PUBLIC_API_URL).toMatch(/^https:\/\/.+\.localhost:/);
	});

	it('is trusted by what it calls: its scheme, and Expo Go on this machine', () => {
		const origins = env().AUTH_TRUSTED_ORIGINS!.split(',');

		expect(origins).toContain('beetlefit-dev://');
		expect(origins).toContain('beetlefit-dev://*');
		expect(origins).toContain(`exp://${LAN}:*`);
		expect(origins).toContain('exp://localhost:*');
		// The browser is still there, and no subnet is.
		expect(origins.some((o) => o.startsWith('https://'))).toBe(true);
		expect(origins.join(',')).not.toContain('*.*');
		expect(env().API_TRUSTED_ORIGINS).toContain('beetlefit-dev://');
	});

	it('gives the auth server the address a phone reaches it on', () => {
		expect(env().AUTH_DEVICE_URL).toBe(`http://${LAN}:3001`);
	});

	it('gives no device address on a machine with no network', () => {
		const resolved = env(null);
		expect(resolved.AUTH_DEVICE_URL).toBeUndefined();
		expect(resolved.AUTH_TRUSTED_ORIGINS).toContain('exp://localhost:*');
	});
});

describe('lanAddress', () => {
	it('is the first private IPv4 address of an interface that is up', () => {
		expect(
			lanAddress({
				lo0: [
					{ address: '127.0.0.1', family: 'IPv4', internal: true } as never,
				],
				utun0: [
					{ address: 'fe80::1', family: 'IPv6', internal: false } as never,
				],
				en0: [
					{ address: '192.168.1.20', family: 'IPv4', internal: false } as never,
				],
			}),
		).toBe('192.168.1.20');
	});

	it('is nothing for a public or link-local address', () => {
		expect(
			lanAddress({
				en0: [
					{ address: '169.254.3.4', family: 'IPv4', internal: false } as never,
					{ address: '8.8.8.8', family: 'IPv4', internal: false } as never,
				],
			}),
		).toBeUndefined();
	});
});
