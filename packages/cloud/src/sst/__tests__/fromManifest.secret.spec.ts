import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it, vi } from 'vitest';
import { fromManifest } from '../fromManifest';

/** What each `RandomPassword` was asked for, by name. */
const drawn = vi.hoisted(() => new Map<string, unknown[]>());

vi.mock('@pulumi/random', () => ({
	RandomPassword: class {
		readonly result: string;
		constructor(name: string, ...rest: unknown[]) {
			drawn.set(name, rest);
			this.result = `generated-${name}`;
		}
	},
}));

const provision = (manifest: ConstructManifest) => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	return fromManifest({} as never, manifest, {}, {});
};

describe('a secret on AWS', () => {
	it('is generated in the format it declares, kept when the format changes', () => {
		const provisioned = provision({
			RouterPassword: {
				kind: 'secret',
				id: 'RouterPassword',
				provides: ['ROUTER_PASSWORD'],
				length: 24,
				symbols: '!@#',
			},
		} as unknown as ConstructManifest);

		expect(provisioned.RouterPassword!.provides().value).toBe(
			'generated-RouterPasswordGenerated',
		);
		expect(drawn.get('RouterPasswordGenerated')).toEqual([
			{ length: 24, special: true, overrideSpecial: '!@#', minSpecial: 1 },
			{
				ignoreChanges: ['length', 'special', 'overrideSpecial', 'minSpecial'],
			},
		]);
	});

	it('is 43 letters, digits, - and _ by default', () => {
		provision({
			AuthSecret: {
				kind: 'secret',
				id: 'AuthSecret',
				provides: ['AUTH_SECRET'],
			},
		} as unknown as ConstructManifest);

		expect(drawn.get('AuthSecretGenerated')?.[0]).toEqual({
			length: 43,
			special: true,
			overrideSpecial: '-_',
			minSpecial: 1,
		});
	});

	it('draws no symbols when told none', () => {
		provision({
			Token: {
				kind: 'secret',
				id: 'Token',
				provides: ['TOKEN'],
				length: 6,
				symbols: '',
			},
		} as unknown as ConstructManifest);

		expect(drawn.get('TokenGenerated')?.[0]).toEqual({
			length: 6,
			special: false,
		});
	});
});
