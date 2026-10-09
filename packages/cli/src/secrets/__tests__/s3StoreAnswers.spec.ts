/**
 * The S3 secrets store against the answers S3 can give: where it finds the
 * endpoint and the credentials, a stage it never read, a refused or
 * conflicting write, a server that omits the ETag, and a bucket that is not
 * there — and the location and migration helpers it is configured with.
 *
 * Against the AWS emulator; the answers it cannot give (a 403 on an object, a
 * 409 conflict, a response without an ETag) through MSW in front of it.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { bypass, HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { deployIdentity } from '../../deploy/identity';
import { projectBucket } from '../../providers/projectBucket';
import {
	deleteSourceCommand,
	differingKeys,
	MigratedSecretsDiffer,
} from '../migrate';
import {
	S3SecretsStoreNeedsRegion,
	s3SecretsKey,
	s3SecretsLocation,
} from '../providers';
import { S3SecretsStore, StageSecretsChanged } from '../s3';
import { initStageSecrets } from '../storage';
import type { SecretsStore } from '../store';

const REGION = 'eu-west-1';
const ACCOUNT = '000000000000';
const STAGE = 'production';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let project: string;

beforeEach(() => {
	project = `ans-${randomUUID().slice(0, 8)}`;
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
});

afterEach(() => vi.unstubAllEnvs());

function open(
	options: Partial<ConstructorParameters<typeof S3SecretsStore>[0]> = {},
): S3SecretsStore {
	return new S3SecretsStore({
		project,
		identity: deployIdentity({ name: project }, ''),
		region: REGION,
		prefix: 'gkm',
		...options,
	});
}

const bucket = () => projectBucket({ name: project }, { accountId: ACCOUNT });
const objectUrl = () =>
	`${LOCALSTACK_URL}/${bucket()}/gkm/${project}/${STAGE}/secrets.json`;

describe('S3SecretsStore: where it reaches S3', { timeout: 60_000 }, () => {
	it('names the project bucket before it knows the account', () => {
		expect(open().bucket).toBe(`gkm-${project}-<account id>`);
		expect(open().location(STAGE)).toBe(
			`s3://gkm-${project}-<account id>/gkm/${project}/${STAGE}/secrets.json`,
		);
	});

	it('reaches the endpoint it is given, with no endpoint in the environment', async () => {
		vi.stubEnv('AWS_ENDPOINT_URL', undefined);
		const secrets = initStageSecrets(STAGE);

		await open({ endpoint: LOCALSTACK_URL }).write(STAGE, secrets);

		expect(await open({ endpoint: LOCALSTACK_URL }).read(STAGE)).toEqual(
			secrets,
		);
	});

	it('reaches S3 through the S3 endpoint variable', async () => {
		vi.stubEnv('AWS_ENDPOINT_URL_S3', LOCALSTACK_URL);
		const secrets = initStageSecrets(STAGE);

		await open().write(STAGE, secrets);

		expect(await open().read(STAGE)).toEqual(secrets);
	});

	it('uses the credentials it is given over the environment', async () => {
		vi.stubEnv('AWS_ACCESS_KEY_ID', undefined);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined);
		const store = open({
			credentials: { accessKeyId: 'LSIAGIVEN', secretAccessKey: 'test' },
		});
		const { s3 } = await (
			store as unknown as { client(): Promise<{ s3: S3Client }> }
		).client();

		expect((await s3.config.credentials()).accessKeyId).toBe('LSIAGIVEN');
		await store.write(STAGE, initStageSecrets(STAGE));
		expect(await store.read(STAGE)).not.toBeNull();
	});

	it('resolves a named profile from the profile, never from AWS_* env', async () => {
		const home = mkdtempSync(join(tmpdir(), 'gkm-s3-profile-'));
		writeFileSync(
			join(home, 'credentials'),
			'[acme-prod]\naws_access_key_id = LSIAPRODKEY\naws_secret_access_key = prod\n',
		);
		writeFileSync(join(home, 'config'), '');
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(home, 'credentials'));
		vi.stubEnv('AWS_CONFIG_FILE', join(home, 'config'));
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'LSIASTAGINGKEY');

		try {
			const { s3 } = await (
				open({ profile: 'acme-prod' }) as unknown as {
					client(): Promise<{ s3: S3Client }>;
				}
			).client();

			expect((await s3.config.credentials()).accessKeyId).toBe('LSIAPRODKEY');
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe('S3SecretsStore: what S3 answers', { timeout: 60_000 }, () => {
	it('replaces a stage it never read, as it is now', async () => {
		await open().write(STAGE, initStageSecrets(STAGE));
		const replaced = { ...initStageSecrets(STAGE), custom: { NEW: '1' } };

		await open().write(STAGE, replaced);

		expect(await open().read(STAGE)).toEqual(replaced);
	});

	it('refuses a write S3 answers with a conflict, by name', async () => {
		const store = open();
		await store.write(STAGE, initStageSecrets(STAGE));
		server.use(
			http.put(objectUrl(), () =>
				HttpResponse.xml(
					'<Error><Code>ConditionalRequestConflict</Code><Message>in flight</Message></Error>',
					{ status: 409 },
				),
			),
		);

		await expect(
			store.write(STAGE, initStageSecrets(STAGE)),
		).rejects.toBeInstanceOf(StageSecretsChanged);
	});

	it('passes any other failed write through', async () => {
		const store = open();
		await store.write(STAGE, initStageSecrets(STAGE));
		server.use(
			http.put(objectUrl(), () =>
				HttpResponse.xml(
					'<Error><Code>AccessDenied</Code><Message>denied</Message></Error>',
					{ status: 403 },
				),
			),
		);

		const refused = await store
			.write(STAGE, initStageSecrets(STAGE))
			.catch((e: unknown) => e);

		expect(refused).not.toBeInstanceOf(StageSecretsChanged);
		expect(refused).toMatchObject({ name: 'AccessDenied' });
	});

	it('passes a refused read through, rather than reading no secrets', async () => {
		await open().write(STAGE, initStageSecrets(STAGE));
		server.use(
			http.get(objectUrl(), () =>
				HttpResponse.xml(
					'<Error><Code>AccessDenied</Code><Message>denied</Message></Error>',
					{ status: 403 },
				),
			),
		);

		await expect(open().read(STAGE)).rejects.toMatchObject({
			name: 'AccessDenied',
		});
	});

	it('passes a refused HEAD through when replacing a stage it never read', async () => {
		await open().write(STAGE, initStageSecrets(STAGE));
		server.use(
			http.head(objectUrl(), () => new HttpResponse(null, { status: 403 })),
		);

		await expect(
			open().write(STAGE, initStageSecrets(STAGE)),
		).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
	});

	it('asks for the ETag before the next write when S3 answered without one', async () => {
		const strip = async (request: Request) => {
			const response = await fetch(bypass(request));
			const headers = new Headers(response.headers);
			headers.delete('etag');
			return new HttpResponse(await response.arrayBuffer(), {
				status: response.status,
				headers,
			});
		};
		server.use(
			http.put(objectUrl(), ({ request }) => strip(request)),
			http.get(objectUrl(), ({ request }) => strip(request)),
		);
		const store = open();
		const first = initStageSecrets(STAGE);
		await store.write(STAGE, first);
		expect(await store.read(STAGE)).toEqual(first);
		server.resetHandlers();

		const second = { ...first, custom: { AFTER: 'yes' } };
		await store.write(STAGE, second);

		expect(await open().read(STAGE)).toEqual(second);
	});

	it('addresses AWS itself by the bucket’s host when no endpoint is set', async () => {
		vi.stubEnv('AWS_ENDPOINT_URL', undefined);
		const { s3 } = await (
			open() as unknown as { client(): Promise<{ s3: S3Client }> }
		).client();

		expect(s3.config.isCustomEndpoint).toBe(false);
		expect(s3.config.forcePathStyle).toBeFalsy();
	});

	it('reads no secrets from a named bucket that is not there, and refuses to write to it', async () => {
		const store = open({ bucket: `missing-${project}` });

		expect(await store.read(STAGE)).toBeNull();
		await expect(
			store.write(STAGE, initStageSecrets(STAGE)),
		).rejects.toMatchObject({ name: 'NoSuchBucket' });
	});
});

describe('s3SecretsLocation', () => {
	it('takes region and prefix from an S3 state, without a trailing slash', () => {
		expect(
			s3SecretsLocation(
				{ provider: 's3' },
				{ provider: 's3', region: 'af-south-1', prefix: 'ops/' },
			),
		).toEqual({ bucket: undefined, region: 'af-south-1', prefix: 'ops' });
	});

	it('prefers its own region, prefix and bucket', () => {
		expect(
			s3SecretsLocation(
				{ provider: 's3', bucket: 'acme', region: 'us-east-1', prefix: 'x' },
				{ provider: 's3', region: 'af-south-1', prefix: 'ops' },
			),
		).toEqual({ bucket: 'acme', region: 'us-east-1', prefix: 'x' });
	});

	it('takes nothing from a state that is not in S3', () => {
		expect(
			s3SecretsLocation(
				{ provider: 's3', region: 'us-east-1' },
				{ provider: 'ssm', region: 'af-south-1' },
			),
		).toEqual({ bucket: undefined, region: 'us-east-1', prefix: 'gkm' });
		for (const state of [undefined, null, { provider: 'ssm', region: 'x' }]) {
			expect(() => s3SecretsLocation({ provider: 's3' }, state)).toThrow(
				S3SecretsStoreNeedsRegion,
			);
		}
	});

	it('keys a stage with no prefix at the project', () => {
		expect(s3SecretsKey('', 'shop', 'prod')).toBe('shop/prod/secrets.json');
		expect(s3SecretsKey('gkm', 'shop', 'prod')).toBe(
			'gkm/shop/prod/secrets.json',
		);
	});
});

describe('migrating: the helpers', () => {
	const custom: SecretsStore = {
		name: 'vault',
		read: async () => null,
		write: async () => {},
	};

	it('prints the command that deletes each kind of source', () => {
		const shop = { name: 'shop' };
		expect(deleteSourceCommand(shop, 'file', custom, 'prod', undefined)).toBe(
			'rm .gkm/secrets/prod.json',
		);
		expect(
			deleteSourceCommand(
				shop,
				{ provider: 'ssm', region: 'eu-west-1' },
				custom,
				'prod',
				'acme',
			),
		).toBe(
			'aws ssm delete-parameter --name /gkm/shop/prod/secrets --region eu-west-1 --profile acme',
		);
		expect(
			deleteSourceCommand(
				shop,
				{ provider: 'secrets-manager', region: 'eu-west-1' },
				custom,
				'prod',
				undefined,
			),
		).toBe(
			'aws secretsmanager delete-secret --secret-id gkm/shop/prod/secrets --region eu-west-1',
		);
		const s3 = {
			name: 's3',
			location: () => 's3://b/gkm/shop/prod/secrets.json',
		};
		expect(
			deleteSourceCommand(
				shop,
				{ provider: 's3' },
				s3 as unknown as SecretsStore,
				'prod',
				undefined,
			),
		).toBe('aws s3 rm s3://b/gkm/shop/prod/secrets.json');
		// A store that cannot say where it keeps the stage, and a custom one.
		expect(
			deleteSourceCommand(shop, { provider: 's3' }, custom, 'prod', undefined),
		).toBeNull();
		expect(
			deleteSourceCommand(
				shop,
				{ provider: custom },
				custom,
				'prod',
				undefined,
			),
		).toBeNull();
	});

	it('says which keys a copy read back got wrong', () => {
		expect(
			new MigratedSecretsDiffer('prod', 's3', ['custom.A', 'urls.B']).message,
		).toContain(
			'read back from s3 differ from the ones copied (custom.A, urls.B).',
		);
		expect(new MigratedSecretsDiffer('prod', 's3', []).message).toContain(
			'differ from the ones copied. The source is untouched',
		);
	});

	it('names every key that differs, or that one side lacks', () => {
		const copied = {
			...initStageSecrets('prod'),
			custom: { A: '1', B: '2' },
			urls: { DATABASE_URL: 'postgres://a' },
		};
		const read = {
			...copied,
			custom: { A: '1', C: '3' },
			urls: { DATABASE_URL: 'postgres://b' },
		};

		expect(differingKeys(copied, read)).toEqual([
			'custom.B',
			'custom.C',
			'urls.DATABASE_URL',
		]);
		expect(differingKeys(copied, null)).toEqual([
			'custom.A',
			'custom.B',
			'urls.DATABASE_URL',
		]);
	});
});
