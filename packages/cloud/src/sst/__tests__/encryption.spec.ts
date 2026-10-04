import { ResourceType } from '@geekmidas/envkit/sst';
import { providedKeyFor, provideKey } from '@geekmidas/manifest';
import { describe, expect, it, vi } from 'vitest';
import { Encryption } from '../aws/Encryption';
import { provisionerFor, resolveEdges } from '../fromManifest';

// A KMS key, as far as the component reads one: what it was created with, and
// an ARN. The SST globals are stubbed the same way for every component.
vi.mock('@pulumi/aws', () => ({
	kms: {
		Key: class {
			readonly arn: string;
			constructor(
				readonly name: string,
				readonly args: Record<string, unknown>,
			) {
				this.arn = `arn:aws:kms:eu-west-1:123456789012:key/${name}`;
			}
		},
	},
}));

const stack = {} as never;

describe('Encryption on AWS', () => {
	it('is two KMS keys: one that rotates for data, one HMAC key for the index', () => {
		const pii = new Encryption(stack, 'Pii', { region: 'eu-west-1' });

		expect(pii.key).toMatchObject({
			name: 'PiiKey',
			args: { enableKeyRotation: true, deletionWindowInDays: 30 },
		});
		expect(pii.indexKey).toMatchObject({
			name: 'PiiIndexKey',
			args: {
				keyUsage: 'GENERATE_VERIFY_MAC',
				customerMasterKeySpec: 'HMAC_256',
			},
		});
	});

	it('provides one kms:// URL, under the key the construct declared', () => {
		const pii = new Encryption(stack, 'Pii', { region: 'eu-west-1' });
		const url = new URL(pii.provides().url as string);

		expect(url.protocol).toBe('kms:');
		expect(url.hostname).toBe('eu-west-1');
		expect(url.searchParams.get('key')).toBe(pii.key.arn);
		expect(url.searchParams.get('index')).toBe(pii.indexKey.arn);
		expect(
			Object.keys(pii.provides()).map((role) =>
				providedKeyFor('Pii', 'encryption', role),
			),
		).toEqual([provideKey('Pii', 'url')]);
		expect(pii._type).toBe(ResourceType.Encryption);
	});

	it('grants a linked function the calls the cipher makes, on these keys only', () => {
		const pii = new Encryption(stack, 'Pii', { region: 'eu-west-1' });

		expect(pii.getSSTLink().include).toEqual([
			{
				permission: {
					actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
					resources: [pii.key.arn],
				},
			},
			{
				permission: {
					actions: ['kms:GenerateMac'],
					resources: [pii.indexKey.arn],
				},
			},
		]);
	});

	it('is provisioned from the manifest in the stage’s region, and links its URL', () => {
		const pii = provisionerFor('encryption')(
			stack,
			{ kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
			{},
			{} as never,
		) as Encryption;

		expect(new URL(pii.provides().url as string).hostname).toBe('eu-west-1');
		expect(
			resolveEdges([{ target: 'Pii', kind: 'encryption' }], { Pii: pii }),
		).toEqual({ link: [pii], envKeys: ['PII_URL'] });
	});
});
