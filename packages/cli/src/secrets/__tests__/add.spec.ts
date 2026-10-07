import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseEmailUrl } from '@geekmidas/emailkit/url';
import { parse as parseS3Url } from '@geekmidas/storage/s3-url';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadComposeApp } from '../../compose/__tests__/__helpers__/composeApp';
import { loadWorkspaceSettings } from '../../config';
import {
	type SecretsAddIo,
	SecretsAddNeedsTerminal,
	type StageKeyJson,
	secretsAddCommand,
} from '../add';
import { CredentialsInvalid } from '../credentialSchemas';
import { secretsSetCommand } from '../index';
import { workspaceStageKeys } from '../stageKeys';
import { initStageSecrets } from '../storage';
import { secretsStoreFor } from '../store';
import { writeServicesApp } from './__helpers__/servicesApp';

/**
 * `gkm secrets:add`, driven through its real prompts with `prompts.inject`:
 * the workspace is loaded and its constructs discovered, the credentials are
 * checked against the construct's own zod schema, and every value lands in
 * the stage's real, encrypted file store.
 */

const STAGE = 'production';

let dir: string;
let home: string;
let lines: string[];
let written: string[];

const io = (interactive = true): SecretsAddIo => ({
	log: (line) => lines.push(line),
	write: (chunk) => written.push(chunk),
	interactive,
});

const store = async (stage = STAGE) =>
	secretsStoreFor(await loadWorkspaceSettings(dir), stage, { home });

const stored = async (stage = STAGE) =>
	(await (await store(stage)).read(stage))?.custom ?? {};

const seed = async (custom: Record<string, string>, stage = STAGE) =>
	(await store(stage)).write(stage, {
		...initStageSecrets(stage),
		custom,
	});

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-secrets-add-'));
	home = realpathSync(await createTempDir('gkm-secrets-add-home-'));
	vi.stubEnv('GKM_HOME', home);
	writeServicesApp(dir);
	lines = [];
	written = [];
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('the keys a stage must be given', () => {
	it('lists each key a deployed stage supplies once, with its construct, kind and readers', async () => {
		const { manifest, runnables } = await loadComposeApp(dir);

		const keys = workspaceStageKeys({
			manifest,
			runnables,
			local: false,
			supplied: { MAIL_URL: 'smtp://x' },
		});

		expect(
			keys.map(({ key, id, kind, apps, set }) => ({
				key,
				id,
				kind,
				apps,
				set,
			})),
		).toEqual([
			{ key: 'MAIL_URL', id: 'Mail', kind: 'email', apps: ['api'], set: true },
			{
				key: 'MAIL_FROM',
				id: 'Mail',
				kind: 'email',
				apps: ['api'],
				set: false,
			},
			{
				key: 'UPLOADS_URL',
				id: 'Uploads',
				kind: 'bucket',
				apps: ['api'],
				set: false,
			},
			{
				key: 'UPLOADS_SERVER_URL',
				id: 'UploadsServer',
				kind: 'file-server',
				apps: ['api'],
				set: false,
			},
			{
				key: 'SHIPPING_CREDENTIALS',
				id: 'Shipping',
				kind: 'external-api',
				apps: ['api'],
				set: false,
			},
		]);
	});

	it('offers the local stage only what it cannot derive: third parties’ credentials', async () => {
		const { manifest, runnables } = await loadComposeApp(dir);

		const keys = workspaceStageKeys({
			manifest,
			runnables,
			local: true,
			supplied: {},
		});

		expect(keys.map((k) => k.key)).toEqual(['SHIPPING_CREDENTIALS']);
	});
});

describe('gkm secrets:add --json', () => {
	it('prints the missing keys as JSON and asks nothing', async () => {
		await seed({ MAIL_URL: 'smtp://user:pw@smtp.example.com:587' });

		await secretsAddCommand(
			{ cwd: dir, stage: STAGE, missing: true, json: true, home },
			io(false),
		);

		const listed = JSON.parse(written.join('')) as StageKeyJson[];
		expect(listed).toEqual([
			{
				key: 'MAIL_FROM',
				kind: 'email',
				construct: 'Mail',
				apps: ['api'],
				set: false,
			},
			{
				key: 'UPLOADS_URL',
				kind: 'bucket',
				construct: 'Uploads',
				apps: ['api'],
				set: false,
			},
			{
				key: 'UPLOADS_SERVER_URL',
				kind: 'file-server',
				construct: 'UploadsServer',
				apps: ['api'],
				set: false,
			},
			{
				key: 'SHIPPING_CREDENTIALS',
				kind: 'external-api',
				construct: 'Shipping',
				apps: ['api'],
				set: false,
			},
		]);
		expect(written.join('')).not.toContain('smtp://');
	});

	it('refuses to prompt without a terminal, pointing at --json and secrets:set', async () => {
		const run = secretsAddCommand({ cwd: dir, stage: STAGE, home }, io(false));

		await expect(run).rejects.toBeInstanceOf(SecretsAddNeedsTerminal);
		await expect(run).rejects.toThrow(
			'gkm secrets:add --stage production --missing --json',
		);
		await expect(run).rejects.toThrow(
			'gkm secrets:set <KEY> <value> --stage production',
		);
	});
});

describe('gkm secrets:add', () => {
	it('builds every kind of key, re-asks what is refused, and saves them encrypted', async () => {
		prompts.inject([
			[
				'MAIL_URL',
				'MAIL_FROM',
				'UPLOADS_URL',
				'UPLOADS_SERVER_URL',
				'SHIPPING_CREDENTIALS',
			],
			// MAIL_URL: host, port, user, password, TLS.
			'smtp.example.com',
			'2525',
			'mailer@example.com',
			'p@ss/word+1',
			'tls',
			// MAIL_FROM: refused, then taken.
			'not-an-address',
			'noreply@shop.example.com',
			// UPLOADS_URL: an S3-compatible store, with a key of its own.
			'compatible',
			'https://minio.example.com',
			'acme-uploads',
			'us-east-1',
			true,
			true,
			'AKIA/EXAMPLE+1',
			'se/cr+et==',
			// UPLOADS_SERVER_URL: refused, then taken.
			'ftp://files.example.com',
			'https://files.shop.example.com',
			// SHIPPING_CREDENTIALS: each field, refused by the schema, then again.
			'bad-key',
			'acct_1',
			false,
			'sk_live_123',
			'acct_1',
			false,
		]);

		const result = await secretsAddCommand(
			{ cwd: dir, stage: STAGE, home },
			io(),
		);

		expect(result.saved).toEqual([
			'MAIL_URL',
			'MAIL_FROM',
			'UPLOADS_URL',
			'UPLOADS_SERVER_URL',
			'SHIPPING_CREDENTIALS',
		]);

		const values = await stored();

		expect(parseEmailUrl(values.MAIL_URL!)).toEqual({
			host: 'smtp.example.com',
			port: 2525,
			secure: true,
			auth: { user: 'mailer@example.com', pass: 'p@ss/word+1' },
		});
		expect(values.MAIL_FROM).toBe('noreply@shop.example.com');
		expect(parseS3Url(values.UPLOADS_URL!)).toEqual({
			bucket: 'acme-uploads',
			region: 'us-east-1',
			endpoint: 'https://minio.example.com',
			forcePathStyle: true,
			accessKeyId: 'AKIA/EXAMPLE+1',
			secretAccessKey: 'se/cr+et==',
		});
		expect(values.UPLOADS_SERVER_URL).toBe('https://files.shop.example.com');
		expect(JSON.parse(values.SHIPPING_CREDENTIALS!)).toEqual({
			apiKey: 'sk_live_123',
			accountId: 'acct_1',
			sandbox: false,
		});
		// A key in the URL: the shared pair was not offered, nor set.
		expect(values.AWS_ACCESS_KEY_ID).toBeUndefined();

		const printed = lines.join('\n');
		expect(printed).toContain('An email address is required');
		expect(printed).toContain('An http:// or https:// URL is required');
		expect(printed).toContain("The schema of 'Shipping' refuses it");
		expect(printed).toMatch(/SHIPPING_CREDENTIALS\.apiKey: .+/);
		// No value is ever printed, and none is on disk in the clear.
		const file = readFileSync(
			join(dir, '.gkm', 'secrets', `${STAGE}.json`),
			'utf-8',
		);
		for (const secret of [
			'p@ss/word+1',
			'se/cr+et==',
			'sk_live_123',
			'bad-key',
		]) {
			expect(printed).not.toContain(secret);
			expect(file).not.toContain(secret);
		}
	});

	it('asks before replacing a key that is set, and offers the shared key pair', async () => {
		await seed({ UPLOADS_URL: 's3://old-bucket?region=eu-west-1' });

		prompts.inject([['UPLOADS_URL'], false]);
		const kept = await secretsAddCommand(
			{ cwd: dir, stage: STAGE, home },
			io(),
		);

		expect(kept.saved).toEqual([]);
		expect((await stored()).UPLOADS_URL).toBe(
			's3://old-bucket?region=eu-west-1',
		);

		prompts.inject([
			['UPLOADS_URL'],
			true,
			// AWS S3, no key of its own — then the shared pair.
			's3',
			'new-bucket',
			'eu-central-1',
			false,
			true,
			'AKIASHARED',
			'shared/secret+',
		]);
		const replaced = await secretsAddCommand(
			{ cwd: dir, stage: STAGE, home },
			io(),
		);

		expect(replaced.saved).toEqual([
			'UPLOADS_URL',
			'AWS_ACCESS_KEY_ID',
			'AWS_SECRET_ACCESS_KEY',
		]);
		const values = await stored();
		expect(parseS3Url(values.UPLOADS_URL!)).toEqual({
			bucket: 'new-bucket',
			region: 'eu-central-1',
		});
		expect(values.AWS_ACCESS_KEY_ID).toBe('AKIASHARED');
		expect(values.AWS_SECRET_ACCESS_KEY).toBe('shared/secret+');
	});

	it('builds an R2 bucket from its account id', async () => {
		prompts.inject([['UPLOADS_URL'], 'r2', 'abc123', 'media', false, false]);

		await secretsAddCommand({ cwd: dir, stage: STAGE, home }, io());

		expect(parseS3Url((await stored()).UPLOADS_URL!)).toEqual({
			bucket: 'media',
			region: 'auto',
			endpoint: 'https://abc123.r2.cloudflarestorage.com',
		});
	});
});

describe('gkm secrets:set', () => {
	let cwd: string;

	beforeEach(() => {
		cwd = process.cwd();
		process.chdir(dir);
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		process.chdir(cwd);
	});

	it("refuses credentials their construct's schema refuses, and saves nothing", async () => {
		await seed({});

		const run = secretsSetCommand(
			'SHIPPING_CREDENTIALS',
			'{"apikey":"x","accountId":"acct_1"}',
			{ stage: STAGE },
		);

		const error = await run.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CredentialsInvalid);
		expect((error as Error).message).toMatch(
			/nothing was saved:\s+SHIPPING_CREDENTIALS\.apiKey: .+/,
		);
		expect((error as Error).message).not.toContain('"x"');
		expect(await stored()).toEqual({});
	});

	it('saves credentials the schema takes', async () => {
		await seed({});

		await secretsSetCommand(
			'SHIPPING_CREDENTIALS',
			'{"apiKey":"sk_1","accountId":"acct_1"}',
			{ stage: STAGE },
		);

		expect(JSON.parse((await stored()).SHIPPING_CREDENTIALS!)).toEqual({
			apiKey: 'sk_1',
			accountId: 'acct_1',
		});
	});
});
