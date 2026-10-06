import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerBuildFailed, ImageRefInvalid } from '../../docker';
import { CommandFailed, run } from '../../run';
import { keyFingerprint } from '../../secrets/encryption';
import {
	applicationName,
	deployDocker,
	dockerBuildArgs,
	getImageRef,
	writeCredentialsFile,
} from '../docker';

// Docker itself is not run: `run` records the argv it would have received.
vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
}));

describe('getImageRef', () => {
	it('should return image with registry prefix', () => {
		const result = getImageRef('ghcr.io/myorg', 'myapp', 'v1.0.0');
		expect(result).toBe('ghcr.io/myorg/myapp:v1.0.0');
	});

	it('should return image without registry when undefined', () => {
		const result = getImageRef(undefined, 'myapp', 'v1.0.0');
		expect(result).toBe('myapp:v1.0.0');
	});

	it('should handle different tag formats', () => {
		expect(getImageRef('docker.io', 'app', 'latest')).toBe(
			'docker.io/app:latest',
		);
		expect(getImageRef('docker.io', 'app', 'sha-abc123')).toBe(
			'docker.io/app:sha-abc123',
		);
		expect(getImageRef('docker.io', 'app', '1.2.3-beta.1')).toBe(
			'docker.io/app:1.2.3-beta.1',
		);
	});

	it('should handle registry with port', () => {
		const result = getImageRef('localhost:5000', 'myapp', 'dev');
		expect(result).toBe('localhost:5000/myapp:dev');
	});

	it('should handle nested registry paths', () => {
		const result = getImageRef('gcr.io/my-project/images', 'api', 'prod');
		expect(result).toBe('gcr.io/my-project/images/api:prod');
	});
});

describe('the name that scopes a deploy', () => {
	it('scopes the application by stage, so two stages cannot collide', () => {
		// The bug this closes: the application name carried no stage, so
		// deploying `staging` into the same project matched the production
		// application by name and redeployed it.
		expect(applicationName('production', 'shop', 'api')).not.toBe(
			applicationName('staging', 'shop', 'api'),
		);
	});

	it('names an application the way it names a construct', () => {
		// The application beside `production-shop-database` is
		// `production-shop-api`, through the same `scopedName`. It used to be the
		// bare app key on the workspace path — a project holding an `api` and a
		// `web` that every stage would collide on.
		expect(applicationName('production', 'shop', 'api')).toBe(
			'production-shop-api',
		);
		expect(applicationName('production', 'shop', 'web')).toBe(
			'production-shop-web',
		);
	});

	it('does not repeat a project name the app already is', () => {
		// A project named for its one application would otherwise be
		// `production-shop-shop`.
		expect(applicationName('production', 'shop', 'shop')).toBe(
			'production-shop',
		);
	});
});

describe('the docker build command line', () => {
	const dockerfilePath = '/app/.gkm/docker/Dockerfile';

	it('is one argument per value, each flag joined to its value', () => {
		expect(
			dockerBuildArgs({
				dockerfilePath,
				imageRef: 'ghcr.io/acme/api:v1',
				buildArgs: ['NEXT_PUBLIC_API_URL=https://api.example.com'],
				credentialsFile: '/tmp/gkm-credentials-x/gkm_credentials',
			}),
		).toEqual([
			'build',
			'--platform=linux/amd64',
			`--file=${dockerfilePath}`,
			'--tag=ghcr.io/acme/api:v1',
			'--build-arg=NEXT_PUBLIC_API_URL=https://api.example.com',
			'--secret=id=gkm_credentials,src=/tmp/gkm-credentials-x/gkm_credentials',
			'.',
		]);
	});

	it.each([
		['a shell separator', 'api:v1;rm -rf /', 'X=1;id'],
		['a command substitution', 'api:$(id)', 'X=$(id)'],
		['spaces', 'api:v1 --push', 'X=a b'],
		['a leading dash', '-api', '--privileged'],
	])('keeps a value holding %s inside its own argument', (_, ref, arg) => {
		const args = dockerBuildArgs({
			dockerfilePath,
			imageRef: ref,
			buildArgs: [arg],
		});

		// Nothing split, and nothing a flag of its own.
		expect(args).toEqual([
			'build',
			'--platform=linux/amd64',
			`--file=${dockerfilePath}`,
			`--tag=${ref}`,
			`--build-arg=${arg}`,
			'.',
		]);
	});
});

describe('the credentials file a build reads', () => {
	it('holds ciphertext then IV, readable by its owner alone, until cleaned up', async () => {
		const { path, cleanup } = await writeCredentialsFile({
			encrypted: 'Y2lwaGVy',
			iv: 'abcdef012345abcdef012345',
		});

		expect(readFileSync(path, 'utf8')).toBe(
			'Y2lwaGVy\nabcdef012345abcdef012345\n',
		);
		expect(statSync(path).mode & 0o777).toBe(0o600);

		await cleanup();
		expect(existsSync(path)).toBe(false);
		expect(existsSync(dirname(path))).toBe(false);
	});
});

describe('deployDocker', () => {
	let root: string;
	let cwd: string;
	let out: string[];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-deploy-docker-'));
		cwd = process.cwd();
		// A one-app project with its bundle built, as `gkm deploy` meets it.
		writeFileSync(
			join(root, 'gkm.config.ts'),
			`import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  openapi: false,
});
`,
		);
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({ name: '@shop/api', type: 'module' }),
		);
		writeFileSync(join(root, 'pnpm-lock.yaml'), '');
		mkdirSync(join(root, '.gkm/server/dist'), { recursive: true });
		writeFileSync(join(root, '.gkm/server/dist/server.mjs'), '');
		process.chdir(root);

		out = [];
		for (const level of ['log', 'warn', 'error', 'info'] as const) {
			vi.spyOn(console, level).mockImplementation((...a) => {
				out.push(a.join(' '));
			});
		}
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
	});

	afterEach(() => {
		process.chdir(cwd);
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	it('names the key by its fingerprint and never prints it', async () => {
		const masterKey = 'f'.repeat(32) + '0'.repeat(32);

		const result = await deployDocker({
			stage: 'production',
			tag: 'v1',
			masterKey,
			config: { registry: 'ghcr.io/acme', imageName: 'api' },
		});

		const said = out.join('\n');
		expect(said).not.toContain(masterKey);
		expect(keyFingerprint(masterKey)).toMatch(/^[0-9a-f]{8}$/);
		expect(said).toContain(keyFingerprint(masterKey));
		// Still returned, deprecated, for callers that read it today.
		expect(result).toEqual({ imageRef: 'ghcr.io/acme/api:v1', masterKey });
		expect(vi.mocked(run).mock.calls.map(([c, a]) => [c, a[0]])).toEqual([
			['docker', 'build'],
			['docker', 'push'],
		]);
	});

	it.each([
		['a shell separator', 'v1;id'],
		['a command substitution', '$(id)'],
		['a space', 'v1 --push'],
		['a leading dash', '-v1'],
	])('refuses a tag holding %s before running docker', async (_, tag) => {
		await expect(
			deployDocker({
				stage: 'production',
				tag,
				config: { registry: 'ghcr.io/acme', imageName: 'api' },
			}),
		).rejects.toBeInstanceOf(ImageRefInvalid);
		expect(run).not.toHaveBeenCalled();
	});

	it('removes the credentials file when the build fails', async () => {
		let secretPath: string | undefined;
		vi.mocked(run).mockImplementation(async (_, args) => {
			secretPath = args
				.find((a) => a.startsWith('--secret='))
				?.split(',src=')[1];
			throw new CommandFailed('docker', args, 1, null);
		});

		await expect(
			deployDocker({
				stage: 'production',
				tag: 'v1',
				config: { imageName: 'api' },
				credentials: {
					encrypted: 'Y2lwaGVy',
					iv: 'abcdef012345abcdef012345',
				},
			}),
		).rejects.toBeInstanceOf(DockerBuildFailed);
		expect(secretPath).toBeDefined();
		expect(existsSync(secretPath!)).toBe(false);
	});
});
