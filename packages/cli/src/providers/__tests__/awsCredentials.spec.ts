/**
 * How a provider finds the stage's AWS account — a named profile, the
 * environment's keys, the SDK's chain, or none — the client config each
 * becomes, and what a stage missing them is told.
 */

import { describe, expect, it, vi } from 'vitest';
import {
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../aws';
import { ProviderCredentialsMissing } from '../index';
import { StageProviderDisabled } from '../notes';

/** No credentials anywhere the SDK's chain looks. */
const BARE = {
	AWS_CONFIG_FILE: '/dev/null',
	AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
	AWS_EC2_METADATA_DISABLED: 'true',
};

describe('awsProvisioningCredentials', () => {
	it('is the named profile, in the environment’s region', async () => {
		expect(
			await awsProvisioningCredentials({
				stage: 'prod',
				profile: 'acme-prod',
				env: { AWS_DEFAULT_REGION: 'af-south-1' },
			}),
		).toEqual({ profile: 'acme-prod', region: 'af-south-1' });
		expect(
			await awsProvisioningCredentials({
				stage: 'prod',
				profile: 'acme-prod',
				env: {},
			}),
		).toEqual({ profile: 'acme-prod' });
	});

	it('is the environment’s keys when no profile is named', async () => {
		expect(
			await awsProvisioningCredentials({
				stage: 'prod',
				env: {
					...BARE,
					AWS_ACCESS_KEY_ID: 'LSIAKEY',
					AWS_SECRET_ACCESS_KEY: 'secret',
					AWS_REGION: 'eu-west-1',
				},
				home: '/nonexistent-gkm-home',
			}),
		).toMatchObject({ accessKeyId: 'LSIAKEY', secretAccessKey: 'secret' });
	});

	it('is the SDK’s chain when it finds credentials, and none when it does not', async () => {
		for (const key of [
			'AWS_ACCESS_KEY_ID',
			'AWS_SECRET_ACCESS_KEY',
			'AWS_SESSION_TOKEN',
			'AWS_PROFILE',
			'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
			'AWS_CONTAINER_CREDENTIALS_FULL_URI',
			'AWS_WEB_IDENTITY_TOKEN_FILE',
		]) {
			vi.stubEnv(key, undefined);
		}
		for (const [key, value] of Object.entries(BARE)) vi.stubEnv(key, value);
		try {
			expect(
				await awsProvisioningCredentials({ stage: 'prod', env: { ...BARE } }),
			).toBeUndefined();

			// The chain reads the process's environment, not the lookup's.
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'LSIACHAIN');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');
			expect(
				await awsProvisioningCredentials({
					stage: 'prod',
					env: { ...BARE, AWS_REGION: 'eu-west-1' },
				}),
			).toEqual({ chain: true, region: 'eu-west-1' });
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe('awsClientConfig', () => {
	it('resolves a profile with fromIni', async () => {
		const config = await awsClientConfig({ profile: 'acme' }, 'eu-west-1');
		expect(config.region).toBe('eu-west-1');
		expect(typeof config.credentials).toBe('function');
	});

	it('passes keys through, with the session token only when there is one', async () => {
		expect(
			await awsClientConfig(
				{ accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' } as never,
				'eu-west-1',
			),
		).toEqual({
			region: 'eu-west-1',
			credentials: {
				accessKeyId: 'A',
				secretAccessKey: 'S',
				sessionToken: 'T',
			},
		});
		expect(
			await awsClientConfig(
				{ accessKeyId: 'A', secretAccessKey: 'S' } as never,
				'eu-west-1',
			),
		).toEqual({
			region: 'eu-west-1',
			credentials: { accessKeyId: 'A', secretAccessKey: 'S' },
		});
	});

	it('leaves the chain to the SDK', async () => {
		expect(await awsClientConfig({ chain: true }, 'us-east-1')).toEqual({
			region: 'us-east-1',
		});
	});
});

describe('awsEndpoint', () => {
	it('prefers the service’s own endpoint variable', () => {
		expect(
			awsEndpoint(
				{ AWS_ENDPOINT_URL_S3: 'http://s3', AWS_ENDPOINT_URL: 'http://all' },
				'S3',
			),
		).toBe('http://s3');
		expect(awsEndpoint({ AWS_ENDPOINT_URL: 'http://all' }, 'IAM')).toBe(
			'http://all',
		);
		expect(awsEndpoint({}, 'S3')).toBeUndefined();
	});
});

describe('what a stage missing a provider’s credentials is told', () => {
	it('names one construct, or several, and the login where there is one', () => {
		const one = new ProviderCredentialsMissing(
			'prod',
			'objects',
			's3',
			['Uploads'],
			['AWS_PROFILE'],
			'AWS credentials',
			'aws',
		);
		expect(one.message).toContain('what Uploads is backed by');
		expect(one.message).toContain('writes its key');
		expect(one.message).toContain('or run gkm login --provider aws');

		const many = new ProviderCredentialsMissing(
			'prod',
			'objects',
			's3',
			['Uploads', 'Avatars'],
			['AWS_PROFILE'],
			'AWS credentials',
		);
		expect(many.message).toContain('Uploads, Avatars are backed by');
		expect(many.message).toContain('writes their keys');
		expect(many.message).not.toContain('gkm login');
	});

	it('names a disabled kind’s constructs, one or several', () => {
		expect(
			new StageProviderDisabled('objects', 'prod', ['Uploads']).message,
		).toContain('Uploads is declared. Name what backs it');
		expect(
			new StageProviderDisabled('objects', 'prod', ['Uploads', 'Avatars'])
				.message,
		).toContain('Uploads, Avatars are declared. Name what backs them');
	});
});
