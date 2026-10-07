import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerBuildFailed, ImageRefInvalid } from '../../docker';
import { CommandFailed, run, runOutput } from '../../run';
import { keyFingerprint } from '../../secrets/encryption';
import {
	deployDocker,
	dockerBuildArgs,
	getImageRef,
	pushedDigest,
	writeCredentialsFile,
} from '../docker';
import { writeShopWorkspace } from './__helpers__/dokployStandIn';

// Docker itself is not run: `run` records the argv it would have received.
vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
	runOutput: vi.fn(),
}));

const DIGEST = `sha256:${'ab'.repeat(32)}`;

describe('pushedDigest', () => {
	beforeEach(() => vi.mocked(runOutput).mockReset());

	it("reads the digest for the ref's own repository", async () => {
		// The same image pushed to two repositories has a digest for each.
		vi.mocked(runOutput).mockResolvedValue(
			`${JSON.stringify([
				`docker.io/other/api@sha256:${'cd'.repeat(32)}`,
				`ghcr.io/acme/shop/shop-api@${DIGEST}`,
			])}\n`,
		);

		expect(await pushedDigest('ghcr.io/acme/shop/shop-api:v1')).toBe(DIGEST);
		expect(vi.mocked(runOutput).mock.calls[0]![1]).toEqual([
			'image',
			'inspect',
			'--format={{json .RepoDigests}}',
			'ghcr.io/acme/shop/shop-api:v1',
		]);
	});

	it('has no digest for an image that was never pushed', async () => {
		vi.mocked(runOutput).mockResolvedValue('[]\n');

		expect(await pushedDigest('ghcr.io/acme/shop/shop-api:v1')).toBe(undefined);
	});
});

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
		vi.mocked(runOutput).mockReset();
		vi.mocked(runOutput).mockResolvedValue(
			JSON.stringify([`ghcr.io/acme/api@${DIGEST}`]),
		);
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
		// Still returned, deprecated, for callers that read it today — beside
		// the digest the push resolved to.
		expect(result).toEqual({
			imageRef: 'ghcr.io/acme/api:v1',
			digest: DIGEST,
			masterKey,
		});
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

describe('deployDocker in a workspace', () => {
	let root: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-deploy-docker-ws-')));
		writeShopWorkspace(root, 'production');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
		vi.mocked(runOutput).mockReset();
		vi.mocked(runOutput).mockResolvedValue('[]');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	it('builds from the Dockerfile gkm docker writes for the app, at the root', async () => {
		await deployDocker({
			stage: 'production',
			tag: 'v1',
			config: { registry: 'ghcr.io/acme', imageName: 'api', appName: 'api' },
			cwd: root,
			appPath: 'apps/api',
		});

		// `.gkm/docker/Dockerfile.api` at the workspace root — what `gkm docker`
		// writes for a workspace — and never `apps/api/.gkm/docker/Dockerfile`,
		// which nothing writes.
		const [, args, options] = vi
			.mocked(run)
			.mock.calls.find(([, a]) => a[0] === 'build')!;
		const dockerfile = join(root, '.gkm/docker/Dockerfile.api');
		expect(args).toContain(`--file=${dockerfile}`);
		expect(existsSync(dockerfile)).toBe(true);
		expect(existsSync(join(root, 'apps/api/.gkm/docker/Dockerfile'))).toBe(
			false,
		);
		// The root is the context the workspace's Dockerfiles prune from.
		expect(options?.cwd).toBe(root);
		expect(args.at(-1)).toBe('.');
	});
});
