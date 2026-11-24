/**
 * `--profile` names the AWS account a command acts in, and wins over every
 * other way of naming one: `AWS_PROFILE`, keys exported for another account,
 * and a profile written into gkm.config.ts (`state.profile`, a Route 53
 * entry's). Each client is asked which keys it would sign with.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storedCredentials } from '../deploy/credentials';
import { createStateStore } from '../deploy/StateStore';
import { createDnsProvider } from '../dns/providers';

/** The access key id each profile, and the environment, signs with. */
const KEYS = {
	flag: 'LSIAFLAGKEY',
	config: 'LSIACONFIGKEY',
	env: 'LSIAENVKEY',
};

type Signing = {
	config: {
		credentials: () => Promise<{ accessKeyId: string }>;
	};
};

/** The key id a store's or a provider's AWS client signs with. */
async function signsWith(holder: unknown): Promise<string> {
	const client = (holder as { client: Signing }).client;
	return (await client.config.credentials()).accessKeyId;
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'gkm-aws-profile-'));
	writeFileSync(
		join(dir, 'credentials'),
		[
			'[from-flag]',
			`aws_access_key_id = ${KEYS.flag}`,
			'aws_secret_access_key = flag-secret',
			'[from-config]',
			`aws_access_key_id = ${KEYS.config}`,
			'aws_secret_access_key = config-secret',
			'[from-env]',
			'aws_access_key_id = LSIAPROFILEENVKEY',
			'aws_secret_access_key = env-profile-secret',
			'',
		].join('\n'),
	);
	writeFileSync(join(dir, 'config'), '');
	vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(dir, 'credentials'));
	vi.stubEnv('AWS_CONFIG_FILE', join(dir, 'config'));
	// Another account, chosen in the shell — neither may win over the flag.
	vi.stubEnv('AWS_PROFILE', 'from-env');
	vi.stubEnv('AWS_ACCESS_KEY_ID', KEYS.env);
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'env-secret');
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

describe('the state store', () => {
	it.for([
		{ provider: 'ssm' as const },
		{ provider: 's3' as const, bucket: 'state' },
	])("signs with --profile over $provider's state.profile", async (config) => {
		const store = await createStateStore({
			config: { ...config, region: 'us-east-1', profile: 'from-config' },
			workspaceRoot: dir,
			workspaceName: 'shop',
			profile: 'from-flag',
		});

		expect(await signsWith(store)).toBe(KEYS.flag);
	});

	it.for([
		{ provider: 'ssm' as const },
		{ provider: 's3' as const, bucket: 'state' },
	])('signs with state.profile when no flag is given ($provider)', async (config) => {
		const store = await createStateStore({
			config: { ...config, region: 'us-east-1', profile: 'from-config' },
			workspaceRoot: dir,
			workspaceName: 'shop',
		});

		expect(await signsWith(store)).toBe(KEYS.config);
	});
});

describe("the deploy's AWS credential", () => {
	it('is --profile, over AWS_PROFILE and exported keys', async () => {
		const credential = await storedCredentials({
			profile: 'from-flag',
			env: process.env,
		}).get({ kind: 'aws', stage: 'prod' });

		expect(credential).toEqual({ profile: 'from-flag' });
	});

	it('is AWS_PROFILE when no flag is given', async () => {
		const credential = await storedCredentials({ env: process.env }).get({
			kind: 'aws',
			stage: 'prod',
		});

		expect(credential).toEqual({ profile: 'from-env' });
	});
});

describe('Route 53', () => {
	it("signs with --profile over the entry's own profile", async () => {
		const provider = await createDnsProvider({
			config: {
				provider: 'route53',
				region: 'us-east-1',
				profile: 'from-config',
			},
			profile: 'from-flag',
		});

		expect(await signsWith(provider)).toBe(KEYS.flag);
	});
});
