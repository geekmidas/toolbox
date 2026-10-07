/**
 * `gkm deploy` through the built-in `sst` target, with a sandbox that runs
 * the project's own steps for real — loading the config, discovering — and
 * stands in for the two commands that would reach AWS.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	type AwsCredential,
	type CredentialProvider,
	MissingCredential,
	storedCredentials,
} from '../../../deploy/credentials';
import { type DeployInput, deploy } from '../../../deploy/deploy';
import type { DeployEvent } from '../../../deploy/events';
import { LocalSandbox } from '../../../sandbox/local';
import type {
	Sandbox,
	SandboxExecOptions,
	SandboxResult,
} from '../../../sandbox/sandbox';
import { SurfacesUnhealthy } from '../health';
import { createSstTarget, SstConfigNotFound } from '../index';
import { SST_OUTPUTS_FILE } from '../outputs';

const STAGE = 'production';
const KEYS: AwsCredential = {
	accessKeyId: 'AKIAEXAMPLEKEYID',
	secretAccessKey: 'wJalrXUtnFEMI-secret-access-key',
	sessionToken: 'session-token-from-oidc',
	region: 'eu-west-1',
};

/** One command the target or the engine ran in the sandbox. */
interface Exec {
	command: string;
	args: readonly string[];
	env: Readonly<Record<string, string>>;
}

/**
 * The project's steps run in a real `LocalSandbox`; `gkm build` and
 * `sst deploy` are recorded and answered here, the second by writing the
 * outputs `deployOutputs` returns, as SST would.
 */
class RecordingSandbox implements Sandbox {
	readonly execs: Exec[] = [];
	readonly isolating = false;
	readonly env: Readonly<Record<string, string>>;
	private readonly local: LocalSandbox;

	constructor(
		readonly root: string,
		private readonly deployOutputs: () => unknown,
		extraEnv: Record<string, string> = {},
	) {
		this.local = new LocalSandbox({ root });
		this.env = { ...this.local.env, ...extraEnv };
	}

	async exec(
		command: string,
		args: readonly string[],
		options: SandboxExecOptions,
	): Promise<SandboxResult> {
		this.execs.push({ command, args, env: options.env });
		if (command !== 'pnpm') return this.local.exec(command, args, options);

		if (args[1] === 'sst') {
			const outputs = this.deployOutputs();
			if (outputs !== undefined) {
				mkdirSync(join(this.root, '.sst'), { recursive: true });
				writeFileSync(
					join(this.root, SST_OUTPUTS_FILE),
					JSON.stringify(outputs),
				);
			}
		}
		return { exitCode: 0, signal: null, stdout: '', stderr: '' };
	}

	/** The commands the target ran: everything through the package manager. */
	targetExecs(): Exec[] {
		return this.execs.filter((exec) => exec.command === 'pnpm');
	}
}

function writeWorkspace(root: string): void {
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ name: 'shop', private: true, type: 'module' }),
	);
	writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
	writeFileSync(join(root, 'sst.config.ts'), 'export default {};\n');
	for (const app of ['api', 'web']) {
		mkdirSync(join(root, 'apps', app), { recursive: true });
		writeFileSync(
			join(root, 'apps', app, 'package.json'),
			JSON.stringify({ name: `@shop/${app}`, type: 'module' }),
		);
	}
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['${STAGE}'] },
  apps: {
    api: { type: 'backend', path: 'apps/api', port: 3000 },
    web: { type: 'web', path: 'apps/web', port: 3001, framework: 'nextjs' },
  },
  deploy: { default: 'sst' },
});
`,
	);
}

/** A provider holding `credential`, for AWS only. */
function awsProvider(
	credential: AwsCredential | undefined,
): CredentialProvider {
	return {
		async get(request) {
			return request.kind === 'aws' ? (credential as never) : undefined;
		},
	};
}

/** A server answering each path with the status `statuses` gives it. */
async function listen(statuses: Record<string, number>): Promise<Server> {
	const server = createServer((request, response) => {
		response.statusCode = statuses[request.url ?? ''] ?? 404;
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return server;
}

function baseUrl(server: Server): string {
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('the sst target', () => {
	let root: string;
	let server: Server | undefined;

	const run = async (
		sandbox: RecordingSandbox,
		input: Partial<DeployInput> = {},
	) => {
		const started = deploy({
			cwd: root,
			stage: STAGE,
			tag: 'v1',
			credentials: awsProvider(KEYS),
			sandbox,
			childOutput: 'ignore',
			// Quick to give up: a surface that is down here stays down.
			targets: {
				sst: createSstTarget({
					health: { attempts: 2, delayMs: 0, timeoutMs: 5_000 },
				}),
			},
			...input,
		});
		const events: DeployEvent[] = [];
		for await (const event of started) events.push(event);
		return {
			events,
			result: await started.result.catch((error: unknown) => error),
		};
	};

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-sst-target-')));
		writeWorkspace(root);
	});

	afterEach(async () => {
		if (server) await new Promise((resolve) => server!.close(resolve));
		server = undefined;
		rmSync(root, { recursive: true, force: true });
	});

	it('builds with gkm, deploys with sst, and checks each surface', async () => {
		server = await listen({ '/health': 200, '/': 200 });
		const url = baseUrl(server);
		// What `run()` returns, as SST writes it: any casing, nested or not.
		const sandbox = new RecordingSandbox(root, () => ({
			Api: url,
			web: { url: `${url}/` },
			Bucket: 'shop-production-uploads',
		}));

		const { events, result } = await run(sandbox);

		expect(result).toMatchObject({
			stage: STAGE,
			dryRun: false,
			successCount: 2,
			urls: { api: url, web: `${url}/` },
		});
		expect(
			sandbox.targetExecs().map(({ command, args }) => [command, ...args]),
		).toEqual([
			['pnpm', 'exec', 'gkm', 'build', '--provider', 'aws', '--stage', STAGE],
			['pnpm', 'exec', 'sst', 'deploy', '--stage', STAGE],
		]);
		expect(events.filter((e) => e.type === 'health.checked')).toEqual([
			{
				type: 'health.checked',
				app: 'api',
				url: `${url}/health`,
				healthy: true,
				status: 200,
				attempt: 1,
			},
			{
				type: 'health.checked',
				app: 'web',
				url: `${url}/`,
				healthy: true,
				status: 200,
				attempt: 1,
			},
		]);
		expect(
			events
				.filter((e) => e.type.startsWith('phase.'))
				.map((e) => `${e.type} ${(e as { phase: string }).phase}`),
		).toEqual([
			'phase.started validate',
			'phase.finished validate',
			'phase.started build',
			'phase.finished build',
			'phase.started release',
			'phase.finished release',
			'phase.started verify',
			'phase.finished verify',
		]);
	}, 60_000);

	it('hands AWS credentials to sst deploy and to nothing else', async () => {
		const sandbox = new RecordingSandbox(root, () => ({}));

		const { events, result } = await run(sandbox);

		expect(result).toMatchObject({ successCount: 2 });
		const sst = sandbox.execs.filter((exec) => exec.args[1] === 'sst');
		expect(sst).toHaveLength(1);
		expect(sst[0]!.env).toMatchObject({
			AWS_ACCESS_KEY_ID: KEYS.accessKeyId,
			AWS_SECRET_ACCESS_KEY: (KEYS as { secretAccessKey: string })
				.secretAccessKey,
			AWS_SESSION_TOKEN: 'session-token-from-oidc',
			AWS_REGION: 'eu-west-1',
		});
		// The build, loading the config, discovering: none sees any of it.
		const others = sandbox.execs.filter((exec) => exec.args[1] !== 'sst');
		expect(others.length).toBeGreaterThan(1);
		for (const exec of others) {
			expect(
				Object.keys(exec.env).filter((name) => name.startsWith('AWS_')),
			).toEqual([]);
			expect(JSON.stringify(exec.env)).not.toContain('secret-access-key');
		}
		// And it is masked in everything the run reports.
		expect(JSON.stringify(events)).not.toContain('secret-access-key');
	}, 60_000);

	it('passes a profile alone, whatever AWS_* the sandbox carries', async () => {
		const sandbox = new RecordingSandbox(root, () => ({}), {
			AWS_ACCESS_KEY_ID: 'AKIASTAGINGLEFTOVER',
			AWS_SECRET_ACCESS_KEY: 'staging-leftover-secret',
		});

		await run(sandbox, {
			credentials: awsProvider({ profile: 'shop-prod' }),
		});

		const sst = sandbox.execs.find((exec) => exec.args[1] === 'sst')!;
		expect(
			Object.keys(sst.env).filter((name) => name.startsWith('AWS_')),
		).toEqual(['AWS_PROFILE']);
		expect(sst.env.AWS_PROFILE).toBe('shop-prod');
	}, 60_000);

	it('fails verify, naming each surface that does not answer', async () => {
		server = await listen({ '/health': 503, '/': 200 });
		const url = baseUrl(server);
		const sandbox = new RecordingSandbox(root, () => ({ api: url, web: url }));

		const { events, result } = await run(sandbox);

		expect(result).toBeInstanceOf(SurfacesUnhealthy);
		expect(result).toMatchObject({
			stage: STAGE,
			surfaces: [{ app: 'api', url: `${url}/health`, status: 503 }],
		});
		expect(
			events
				.filter((e) => e.type === 'health.checked' && e.app === 'api')
				.map((e) => (e as { attempt: number }).attempt),
		).toEqual([1, 2]);
		expect(events.at(-1)).toMatchObject({
			type: 'deploy.failed',
			error: { name: 'SurfacesUnhealthy' },
		});
	}, 60_000);

	it('checks nothing it has no URL for, and never an earlier deploy’s', async () => {
		// Another stage's outputs, from the same checkout.
		mkdirSync(join(root, '.sst'));
		writeFileSync(
			join(root, SST_OUTPUTS_FILE),
			JSON.stringify({ api: 'http://127.0.0.1:9/' }),
		);
		const sandbox = new RecordingSandbox(root, () => undefined);

		const { events, result } = await run(sandbox);

		expect(result).toMatchObject({ successCount: 2, urls: {} });
		expect(existsSync(join(root, SST_OUTPUTS_FILE))).toBe(false);
		expect(events.some((e) => e.type === 'health.checked')).toBe(false);
		expect(
			events.filter(
				(e) => e.type === 'log' && e.message.includes('No URL for api'),
			),
		).toHaveLength(1);
	}, 60_000);

	it('plans without running anything on a dry run', async () => {
		const sandbox = new RecordingSandbox(root, () => ({}));

		const { events, result } = await run(sandbox, { dryRun: true });

		expect(result).toMatchObject({ dryRun: true, successCount: 0 });
		expect(sandbox.targetExecs()).toEqual([]);
		expect(
			events
				.filter((e) => e.type === 'resource.planned')
				.map((e) => (e as { key: string }).key),
		).toEqual(['application:api', 'application:web']);
	}, 60_000);

	it('refuses a workspace without sst.config.ts', async () => {
		rmSync(join(root, 'sst.config.ts'));
		const sandbox = new RecordingSandbox(root, () => ({}));

		const { result } = await run(sandbox);

		expect(result).toBeInstanceOf(SstConfigNotFound);
		expect(result).toMatchObject({ cwd: root });
		expect(sandbox.targetExecs()).toEqual([]);
	}, 60_000);

	it('refuses to deploy without AWS credentials', async () => {
		const sandbox = new RecordingSandbox(root, () => ({}));

		const { result } = await run(sandbox, {
			credentials: awsProvider(undefined),
		});

		expect(result).toBeInstanceOf(MissingCredential);
		expect(result).toMatchObject({ kind: 'aws', target: STAGE });
		expect((result as Error).message).toContain('AWS_PROFILE');
		expect(sandbox.targetExecs()).toEqual([]);
	}, 60_000);

	it('is the built-in sst, without a host override', async () => {
		rmSync(join(root, 'sst.config.ts'));
		const sandbox = new RecordingSandbox(root, () => ({}));

		const { result } = await run(sandbox, { targets: {} });

		expect(result).toBeInstanceOf(SstConfigNotFound);
	}, 60_000);
});

describe('AWS credentials from the environment', () => {
	const get = (env: NodeJS.ProcessEnv) =>
		storedCredentials({ env, home: '/nonexistent' }).get({
			kind: 'aws',
			stage: STAGE,
		});

	it('uses a profile alone, over any exported keys', async () => {
		await expect(
			get({
				AWS_PROFILE: 'shop-prod',
				AWS_ACCESS_KEY_ID: 'AKIASTAGING',
				AWS_SECRET_ACCESS_KEY: 'staging',
				AWS_REGION: 'eu-west-1',
			}),
		).resolves.toEqual({ profile: 'shop-prod', region: 'eu-west-1' });
	});

	it('takes keys, with a session token, when no profile is named', async () => {
		await expect(
			get({
				AWS_ACCESS_KEY_ID: 'AKIAOIDC',
				AWS_SECRET_ACCESS_KEY: 'oidc-secret',
				AWS_SESSION_TOKEN: 'oidc-token',
				AWS_DEFAULT_REGION: 'af-south-1',
			}),
		).resolves.toEqual({
			accessKeyId: 'AKIAOIDC',
			secretAccessKey: 'oidc-secret',
			sessionToken: 'oidc-token',
			region: 'af-south-1',
		});
	});

	it('has nothing for half a key pair', async () => {
		await expect(get({ AWS_ACCESS_KEY_ID: 'AKIA' })).resolves.toBeUndefined();
		await expect(get({})).resolves.toBeUndefined();
	});
});
