import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { StageProviderDisabled } from '../../providers/notes';
import { initStageSecrets } from '../../secrets/storage';
import { defineTarget } from '../../target/define';
import type { DeployPhaseContext } from '../../target/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import { deploy } from '../deploy';
import { ExternalServicesNotConfigured } from '../devServices';
import type { DeployEvent } from '../events';
import { assertStageReady } from '../readiness';
import type { DeployResult } from '../types';

/**
 * The deploy's one readiness check, against the compose fixture with a
 * bucket served by a file server and mail the API reads: the rules it keeps,
 * and that a deploy runs it before any target is asked anything while a
 * build never runs it at all.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

function withMailAndFiles(root: string): void {
	writeFileSync(
		join(root, 'constructs', 'storage.ts'),
		`import { Email } from '@geekmidas/constructs/email';
import { FileServer } from '@geekmidas/constructs/file-server';

export const uploads = new FileServer('Uploads', { open: ['brand/**'] });
export const mail = new Email('Mail', { templates: {} });
`,
	);
	writeFileSync(
		join(root, 'apps', 'api', 'endpoints', 'upload.ts'),
		`import { api } from '../../../constructs/api.js';
import { mail, uploads } from '../../../constructs/storage.js';

export const upload = api
	.post('/upload')
	.dependsOn([uploads, mail])
	.handle(async () => ({ ok: true }));
`,
	);
}

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-readiness-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	withMailAndFiles(dir);
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
}, 60_000);

afterAll(async () => {
	await cleanupDir(dir);
});

/** What the readiness check is handed: the stage, its secrets, its output. */
function phase(
	overrides: {
		workspace?: NormalizedWorkspace;
		stage?: string;
		custom?: Record<string, string>;
		allowDevServices?: boolean;
	} = {},
) {
	const stage = overrides.stage ?? 'production';
	const warned: string[] = [];
	const events: unknown[] = [];
	const ctx = {
		stage,
		workspace: overrides.workspace ?? workspace,
		manifest,
		runnables,
		background,
		allowDevServices: overrides.allowDevServices ?? false,
		secrets: {
			read: async () => ({
				...initStageSecrets(stage),
				custom: overrides.custom ?? {},
			}),
		},
		// A stage nothing has been recorded for yet.
		state: { read: async () => null },
		logger: { info: () => {}, warn: (m: string) => warned.push(m) },
		emit: (event: unknown) => events.push(event),
	} as unknown as DeployPhaseContext<unknown>;
	return { ctx, warned, events };
}

const caught = async (run: Promise<unknown>) =>
	run.then(
		() => undefined,
		(error: unknown) => error,
	);

describe('a deployed stage', () => {
	it('is refused while its secrets configure neither mail nor storage, naming every key at once', async () => {
		const error = await caught(assertStageReady(phase().ctx));

		expect(error).toBeInstanceOf(ExternalServicesNotConfigured);
		const missing = (error as ExternalServicesNotConfigured).missing;
		expect(missing.map((m) => m.key)).toEqual([
			'MAIL_URL',
			'MAIL_FROM',
			'UPLOADS_URL',
			'UPLOADS_SERVER_URL',
		]);
		// A bucket's credentials are optional, so neither half is asked for.
		expect(missing.map((m) => m.key)).not.toContain('AWS_ACCESS_KEY_ID');
		expect(missing.find((m) => m.key === 'MAIL_URL')?.apps).toEqual(['api']);
		const message = (error as Error).message;
		for (const { key } of missing) {
			expect(message).toContain(`gkm secrets:set ${key} '`);
		}
		expect(message).toContain('--stage production');
		expect(message).toContain('with --allow-dev-services.');
	});

	it('is ready once its secrets hold every key', async () => {
		const ready = assertStageReady(
			phase({
				custom: {
					MAIL_URL: 'smtp://user:password@smtp.example.com:587',
					MAIL_FROM: 'noreply@shop.example.com',
					UPLOADS_URL: 's3://acme-uploads?region=eu-west-1',
					UPLOADS_SERVER_URL: 'https://files.shop.example.com',
				},
			}).ctx,
		);

		await expect(ready).resolves.toBeUndefined();
	});

	it('runs a dev service for each where allowed, saying so once per service', async () => {
		const { ctx, warned, events } = phase({ allowDevServices: true });

		await assertStageReady(ctx);

		expect(events).toEqual([
			{
				type: 'dev-service.used',
				service: 'mailpit',
				stage: 'production',
				constructs: ['Mail'],
			},
			{
				type: 'dev-service.used',
				service: 'minio',
				stage: 'production',
				constructs: ['Uploads'],
			},
		]);
		expect(warned).toHaveLength(2);
		expect(warned.join('\n')).toMatch(/Mailpit[\s\S]*delivers NO mail/);
	});

	describe("with a provider backing the stage's buckets", () => {
		const withS3 = (objects: unknown): NormalizedWorkspace =>
			({
				...workspace,
				deploy: {
					...workspace.deploy,
					objects: { production: objects },
				},
			}) as NormalizedWorkspace;

		it('names what creates the bucket and its server, and offers no dev service for them', async () => {
			const error = await caught(
				assertStageReady(
					phase({
						workspace: withS3({ provider: 's3', region: 'eu-west-1' }),
						allowDevServices: true,
					}).ctx,
				),
			);

			// Mail is still a dev service's; the bucket is the provider's, so it
			// is asked for — with what creates it.
			expect(error).toBeInstanceOf(ExternalServicesNotConfigured);
			const missing = (error as ExternalServicesNotConfigured).missing;
			expect(missing.map((m) => m.key)).toEqual([
				'UPLOADS_URL',
				'UPLOADS_SERVER_URL',
			]);
			expect(missing[0]?.service).toBeUndefined();
			const message = (error as Error).message;
			expect(message).toContain(
				'deploy.objects.production is s3: the deploy (gkm deploy --stage production) creates it and writes this key',
			);
			expect(message).not.toContain('--allow-dev-services');
		});

		it('refuses a bucket on a stage that has none, before asking for a key', async () => {
			const error = await caught(
				assertStageReady(phase({ workspace: withS3(false) }).ctx),
			);

			expect(error).toBeInstanceOf(StageProviderDisabled);
		});
	});
});

describe('the local stage', () => {
	it('derives its mail and storage, and is asked for neither', async () => {
		const { ctx, events } = phase({ stage: 'development' });

		await expect(assertStageReady(ctx)).resolves.toBeUndefined();
		expect(events).toEqual([]);
	});
});

describe('through deploy()', { timeout: 60_000 }, () => {
	/** A server target that records which of its phases ran. */
	function standIn() {
		const ran: string[] = [];
		const result = (ctx: DeployPhaseContext<unknown>): DeployResult => ({
			apps: [],
			projectId: '',
			successCount: 0,
			failedCount: 0,
			stage: ctx.stage,
			identity: ctx.identity.key,
			tag: ctx.tag,
			dryRun: ctx.dryRun,
			environmentId: '',
			skipped: [],
			urls: {},
			changes: [],
		});
		const target = defineTarget<undefined, undefined>({
			name: 'stand-in',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'target', images: true },
			async validate() {
				ran.push('validate');
			},
			async ready() {
				ran.push('ready');
			},
			async plan() {
				ran.push('plan');
			},
			async build() {
				ran.push('build');
			},
			async release() {
				ran.push('release');
			},
			result: (ctx) => result(ctx),
		});
		return { target, ran };
	}

	async function run(options: { dryRun?: boolean; buildOnly?: boolean }) {
		const { target, ran } = standIn();
		const deploying = deploy({
			cwd: dir,
			stage: 'production',
			target: 'stand-in',
			targets: { 'stand-in': target },
			...options,
		});
		const events: DeployEvent[] = [];
		for await (const event of deploying) events.push(event);
		const error = await caught(deploying.result);
		return { ran, events, error };
	}

	it('refuses a stage missing keys before the target is asked anything', async () => {
		const { ran, events, error } = await run({ dryRun: true });

		expect(error).toBeInstanceOf(ExternalServicesNotConfigured);
		expect(ran).toEqual([]);
		expect(events).toContainEqual(
			expect.objectContaining({ type: 'phase.failed', phase: 'validate' }),
		);
	});

	it('never asks a build: the target validates and builds, and nothing else', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { ran, error } = await run({ buildOnly: true });

			expect(error).toBeUndefined();
			expect(ran).toEqual(['validate', 'build']);
		} finally {
			warn.mockRestore();
		}
	});
});
