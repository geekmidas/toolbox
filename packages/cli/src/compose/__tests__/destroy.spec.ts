/**
 * `gkm compose --destroy`: what it asks before it deletes anything, what it
 * deletes once asked, and what it leaves. The AWS half is proven against the
 * emulator in `providers/__tests__/s3Destroy.integration.spec.ts`; here the
 * stage has no AWS resources, so nothing reaches an account.
 */

import { realpathSync } from 'node:fs';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { createStateStore, type StateStore } from '../../deploy/StateStore';
import { createComposeState } from '../../deploy/state';
import { secretsStoreFor } from '../../secrets/store';
import {
	ComposeDestroyNeedsAwsCredentials,
	ComposeDestroyNeedsTerminal,
	ComposeDestroyNotConfirmed,
	composeDestroyCommand,
} from '../destroy';
import {
	ComposeDestroyConflict,
	ComposeSecretsNeedsDestroy,
	composeCommand,
} from '../index';
import {
	loadComposeApp,
	serveFrom,
	WARM_TIMEOUT,
	warmComposeApp,
	writeComposeApp,
} from './__helpers__/composeApp';
import { fakeDocker } from './__helpers__/fakeDocker';

const STAGE = 'production';
const PROJECT = 'compose-app-production';

let dir: string;
let home: string;
let state: StateStore;
let said: string[];

beforeAll(warmComposeApp, WARM_TIMEOUT);

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-destroy-'));
	home = realpathSync(await createTempDir('gkm-compose-destroy-home-'));
	vi.stubEnv('GKM_HOME', home);
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	await serveFrom(dir, STAGE, undefined, home);
	const { workspace } = await loadComposeApp(dir);
	state = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	await state.write(STAGE, createComposeState(STAGE), {
		expectedVersion: null,
	});
	// What a deploy recorded: a key it wrote into the secrets, and a
	// resource gkm has no way to delete yet.
	await state.putResource(STAGE, {
		key: 'file-server:UploadsServer',
		type: 'url',
		id: 'https://uploads.example.com',
		status: 'ready',
	});
	await state.putResource(STAGE, {
		key: 'ses-receipt-rule:Inbox',
		type: 'ses-receipt-rule',
		id: 'gkm-compose-app-production-inbox',
		status: 'ready',
	});
	said = [];
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

/** A destroy of the stage, with a person at the terminal typing `typed`. */
const destroy = (
	typed: string | undefined,
	options: { secrets?: boolean; dryRun?: boolean } = {},
) => {
	const fake = fakeDocker();
	const asked: string[] = [];
	const run = composeDestroyCommand(
		{ cwd: dir, stage: STAGE, ...options },
		{
			docker: fake.docker,
			interactive: () => typed !== undefined,
			ask: async (question) => {
				asked.push(question);
				return typed ?? '';
			},
			home,
			log: (line) => said.push(line),
		},
	);
	return { run, calls: fake.calls, asked };
};

const records = async () =>
	Object.keys((await state.read(STAGE))?.resources ?? {}).sort();

const secrets = async () => {
	const { workspace } = await loadComposeApp(dir);
	return (await secretsStoreFor(workspace, STAGE, { home })).read(STAGE);
};

describe('gkm compose --destroy', () => {
	it('refuses with no terminal to type the project at, before touching anything', async () => {
		const { run, calls, asked } = destroy(undefined);

		await expect(run).rejects.toBeInstanceOf(ComposeDestroyNeedsTerminal);
		expect(calls).toEqual([]);
		expect(asked).toEqual([]);
		expect(await records()).toEqual([
			'file-server:UploadsServer',
			'ses-receipt-rule:Inbox',
		]);
	});

	it('prints what it would delete with --dry-run, anywhere, and deletes nothing', async () => {
		const { run, calls, asked } = destroy(undefined, { dryRun: true });

		await run;

		expect(calls).toEqual([]);
		expect(asked).toEqual([]);
		const printed = said.join('\n');
		expect(printed).toContain(`stack ${PROJECT}`);
		expect(printed).toContain('its volumes');
		expect(printed).toMatch(
			/ses-receipt-rule gkm-compose-app-production-inbox — gkm does not delete/,
		);
		expect(printed).toContain('nothing was deleted');
		expect(await records()).toHaveLength(2);
	});

	it.each([
		['the stage alone', 'production'],
		['the project alone', 'compose-app'],
		['nothing', ''],
	])('deletes nothing when %s is typed', async (_what, typed) => {
		const { run, calls, asked } = destroy(typed);

		await expect(run).rejects.toBeInstanceOf(ComposeDestroyNotConfirmed);
		expect(asked).toEqual([`\n   Type ${PROJECT} to destroy it: `]);
		expect(calls).toEqual([]);
		expect(await records()).toHaveLength(2);
		expect(await secrets()).not.toBeNull();
	});

	it('stops the stack with its volumes once the project is typed, and forgets what it removed', async () => {
		const { run, calls } = destroy(PROJECT);

		await run;

		expect(calls.filter((c) => c.op.startsWith('down'))).toEqual([
			{
				op: 'down --volumes',
				args: PROJECT,
				host: 'ssh://deploy@203.0.113.10',
			},
		]);
		// What it cannot delete stays recorded, and was said to be left.
		expect(await records()).toEqual(['ses-receipt-rule:Inbox']);
		expect(said.join('\n')).toContain('destroyed');
	});

	it("keeps the stage's secrets unless --secrets is passed", async () => {
		await destroy(PROJECT).run;

		expect((await secrets())?.custom.GKM_SERVER_IPV4).toBe('203.0.113.10');
		expect(said.join('\n')).toContain("The stage's secrets are kept");
	});

	it("deletes the stage's secrets with --secrets", async () => {
		await destroy(PROJECT, { secrets: true }).run;

		expect(await secrets()).toBeNull();
	});
});

describe('gkm compose --destroy, before it deletes anything', () => {
	it('stops, naming the resources, when there are AWS resources and no credentials', async () => {
		await state.putResource(STAGE, {
			key: 's3-bucket:Uploads',
			type: 's3-bucket',
			id: 'compose-app-production-uploads',
			status: 'ready',
			data: { name: 'compose-app-production-uploads', region: 'eu-west-1' },
		});
		const fake = fakeDocker();

		const error = await composeDestroyCommand(
			{ cwd: dir, stage: STAGE },
			{
				docker: fake.docker,
				interactive: () => true,
				ask: async () => PROJECT,
				awsCredentials: async () => undefined,
				home,
				log: (line) => said.push(line),
			},
		).catch((e) => e);

		expect(error).toBeInstanceOf(ComposeDestroyNeedsAwsCredentials);
		expect(error.resources).toEqual(['s3-bucket:Uploads']);
		expect(fake.calls).toEqual([]);
		expect(await records()).toContain('s3-bucket:Uploads');
	});

	it('destroys the local stage on this machine', async () => {
		const fake = fakeDocker();

		await composeDestroyCommand(
			{ cwd: dir, stage: 'development' },
			{
				docker: fake.docker,
				interactive: () => true,
				ask: async () => 'compose-app-development',
				home,
				log: (line) => said.push(line),
			},
		);

		expect(fake.calls.filter((c) => c.op.startsWith('down'))).toEqual([
			{ op: 'down --volumes', args: 'compose-app-development' },
		]);
	});
});

describe('the flags it takes', () => {
	it('refuses --secrets without --destroy', async () => {
		await expect(
			composeCommand({ cwd: dir, stage: STAGE, secrets: true }),
		).rejects.toBeInstanceOf(ComposeSecretsNeedsDestroy);
	});

	it.each([
		[{ down: true }, '--down'],
		[{ build: true }, '--build'],
		[{ pull: true }, '--pull'],
		[{ tag: 'v1' }, '--tag'],
	])('refuses --destroy with %o', async (flags, flag) => {
		const error = await composeCommand({
			cwd: dir,
			stage: STAGE,
			destroy: true,
			...flags,
		}).catch((e) => e);

		expect(error).toBeInstanceOf(ComposeDestroyConflict);
		expect(error.flag).toBe(flag);
	});
});
