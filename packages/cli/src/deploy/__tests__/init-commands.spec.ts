/**
 * `gkm deploy:init`, `deploy:list`, `registry:setup` and `registry:use`.
 *
 * Credentials live under a temp HOME; Dokploy is a stand-in that records what
 * each command asked of it; `deploy:init` writes the gkm.config.ts in a temp
 * working directory.
 */

import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
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
import {
	getDokployRegistryId,
	storeDokployCredentials,
	storeDokployRegistryId,
} from '../../auth/credentials';
import {
	deployInitCommand,
	deployListCommand,
	registrySetupCommand,
	registryUseCommand,
} from '../init';

const ENDPOINT = 'https://dokploy.test';
const server = setupServer();

interface Recorded {
	endpoint: string;
	body?: Record<string, unknown>;
}

describe('deploy and registry commands', () => {
	let home: string;
	let root: string;
	let cwd: string;
	let out: string[];
	let calls: Recorded[];

	/** Serves each route's value (or throws its status), recording calls. */
	function dokploy(routes: Record<string, unknown>) {
		server.use(
			http.all(`${ENDPOINT}/api/:endpoint`, async ({ request, params }) => {
				const endpoint = String(params.endpoint);
				const text = request.method === 'POST' ? await request.text() : '';
				calls.push({ endpoint, ...(text ? { body: JSON.parse(text) } : {}) });
				const value = routes[endpoint];
				if (typeof value === 'number') {
					return HttpResponse.json({ message: 'nope' }, { status: value });
				}
				return HttpResponse.json(value ?? {});
			}),
		);
	}

	const sent = (endpoint: string) =>
		calls.filter((c) => c.endpoint === endpoint).map((c) => c.body);
	const said = () => out.join('\n');

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(async () => {
		home = mkdtempSync(join(tmpdir(), 'gkm-init-home-'));
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-init-ws-')));
		vi.stubEnv('HOME', home);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
		cwd = process.cwd();
		process.chdir(root);
		out = [];
		calls = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		await storeDokployCredentials('token', ENDPOINT);
	});

	afterEach(() => {
		process.chdir(cwd);
		server.resetHandlers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
		rmSync(root, { recursive: true, force: true });
	});

	describe('deploy:init', () => {
		const tree = {
			projectId: 'p1',
			environments: [{ environmentId: 'env1' }],
		};

		it('uses an existing project by id and wires the registry it is given', async () => {
			dokploy({
				'project.one': tree,
				'application.create': { applicationId: 'a1' },
			});

			const config = await deployInitCommand({
				projectName: 'shop',
				appName: 'api',
				projectId: 'p1',
				registryId: 'reg1',
			});

			expect(config).toEqual({
				endpoint: ENDPOINT,
				projectId: 'p1',
				applicationId: 'a1',
			});
			expect(sent('application.update')).toEqual([
				{ applicationId: 'a1', registryId: 'reg1' },
			]);
			expect(calls.some((c) => c.endpoint === 'project.all')).toBe(false);
			// The ids live in the state file, not in a config it would invent.
			expect(existsSync(join(root, 'gkm.config.ts'))).toBe(false);
		});

		it('finds a project by name, whatever its case', async () => {
			dokploy({
				'project.all': [{ projectId: 'p1', name: 'Shop' }],
				'project.one': tree,
				'application.create': { applicationId: 'a1' },
				'registry.all': [],
			});

			const config = await deployInitCommand({
				projectName: 'shop',
				appName: 'api',
			});

			expect(config.projectId).toBe('p1');
			expect(said()).toContain('Found existing project: p1');
			expect(sent('project.create')).toEqual([]);
		});

		it('creates the project and a production environment when neither exists', async () => {
			dokploy({
				'project.all': [],
				'project.create': { project: { projectId: 'p2' } },
				'project.one': { projectId: 'p2', environments: [] },
				'environment.create': { environmentId: 'env2' },
				'application.create': { applicationId: 'a2' },
				'registry.all': [
					{
						registryId: 'reg1',
						registryName: 'GHCR',
						registryUrl: 'ghcr.io',
					},
				],
			});
			writeFileSync(
				join(root, 'gkm.config.ts'),
				"export default defineConfig({\n\troutes: './src/**/*.ts',\n});\n",
			);

			await deployInitCommand({ projectName: 'shop', appName: 'api' });

			expect(sent('environment.create')).toEqual([
				expect.objectContaining({ projectId: 'p2', name: 'production' }),
			]);
			expect(sent('application.create')).toEqual([
				expect.objectContaining({ environmentId: 'env2' }),
			]);
			// Registries are listed so one can be chosen next time.
			expect(said()).toContain('- GHCR: ghcr.io (reg1)');
			// Rediscovered by name next time; nothing is written into the config.
			expect(readFileSync(join(root, 'gkm.config.ts'), 'utf8')).toBe(
				"export default defineConfig({\n\troutes: './src/**/*.ts',\n});\n",
			);
		});

		it('carries on when registries cannot be listed', async () => {
			dokploy({
				'project.one': tree,
				'application.create': { applicationId: 'a1' },
				'registry.all': 500,
			});

			await expect(
				deployInitCommand({
					projectName: 'shop',
					appName: 'api',
					projectId: 'p1',
				}),
			).resolves.toMatchObject({ applicationId: 'a1' });
		});

		it('takes the endpoint it is given over the stored one', async () => {
			server.use(
				http.get('https://other.test/api/project.one', () =>
					HttpResponse.json(tree),
				),
				http.post('https://other.test/api/application.create', () =>
					HttpResponse.json({ applicationId: 'a9' }),
				),
				http.get('https://other.test/api/registry.all', () =>
					HttpResponse.json([]),
				),
			);

			const config = await deployInitCommand({
				endpoint: 'https://other.test',
				projectName: 'shop',
				appName: 'api',
				projectId: 'p1',
			});

			expect(config.endpoint).toBe('https://other.test');
		});
	});

	describe('without credentials', () => {
		it('needs an endpoint from somewhere', async () => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });

			await expect(deployListCommand({ resource: 'projects' })).rejects.toThrow(
				'Dokploy endpoint not specified.',
			);
		});

		it('needs a token even when the endpoint is given', async () => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });

			await expect(
				deployListCommand({ endpoint: ENDPOINT, resource: 'projects' }),
			).rejects.toThrow('Dokploy credentials not found.');
		});
	});

	describe('deploy:list', () => {
		it('lists projects with their descriptions', async () => {
			dokploy({
				'project.all': [
					{ projectId: 'p1', name: 'Shop', description: 'The storefront' },
					{ projectId: 'p2', name: 'Blog' },
				],
			});

			await deployListCommand({ resource: 'projects' });

			expect(out).toEqual(
				expect.arrayContaining([
					'\n   Shop (p1)',
					'     The storefront',
					'\n   Blog (p2)',
				]),
			);
		});

		it('says when there are no projects', async () => {
			dokploy({ 'project.all': [] });

			await deployListCommand({ resource: 'projects' });

			expect(said()).toContain('No projects found');
		});

		it('lists registries, marking the default one', async () => {
			await storeDokployRegistryId('reg2');
			dokploy({
				'registry.all': [
					{
						registryId: 'reg1',
						registryName: 'Hub',
						registryUrl: 'docker.io',
						username: 'u1',
					},
					{
						registryId: 'reg2',
						registryName: 'GHCR',
						registryUrl: 'ghcr.io',
						username: 'u2',
						imagePrefix: 'acme',
					},
				],
			});

			await deployListCommand({ resource: 'registries' });

			expect(out).toEqual(
				expect.arrayContaining([
					'\n   Hub (reg1)',
					'\n   GHCR (default) (reg2)',
					'     Prefix: acme',
				]),
			);
		});

		it('says how to add a registry when there are none', async () => {
			dokploy({ 'registry.all': [] });

			await deployListCommand({ resource: 'registries' });

			expect(said()).toContain('Run "gkm registry:setup"');
		});
	});

	describe('registry:setup', () => {
		const options = {
			registryName: 'GHCR',
			registryUrl: 'ghcr.io',
			username: 'acme-bot',
			password: 'pat',
		};

		it('creates a registry and makes it the default', async () => {
			dokploy({
				'registry.all': [],
				'registry.create': { registryId: 'reg9' },
			});

			await expect(
				registrySetupCommand({ ...options, imagePrefix: 'acme' }),
			).resolves.toBe('reg9');

			expect(sent('registry.create')).toEqual([
				{ ...options, imagePrefix: 'acme' },
			]);
			expect(await getDokployRegistryId()).toBe('reg9');
			expect(said()).toContain('Prefix: acme');
		});

		it('updates a registry with the same URL instead of adding another', async () => {
			dokploy({
				'registry.all': [
					{ registryId: 'reg1', registryName: 'Old', registryUrl: 'ghcr.io' },
				],
			});

			await expect(registrySetupCommand(options)).resolves.toBe('reg1');

			expect(sent('registry.create')).toEqual([]);
			expect(sent('registry.update')).toEqual([
				{
					registryId: 'reg1',
					registryName: 'GHCR',
					username: 'acme-bot',
					password: 'pat',
				},
			]);
		});
	});

	describe('registry:use', () => {
		it('makes an existing registry the default', async () => {
			dokploy({ 'registry.one': { registryId: 'reg1', registryName: 'GHCR' } });

			await registryUseCommand({ registryId: 'reg1' });

			expect(await getDokployRegistryId()).toBe('reg1');
		});

		it('refuses a registry Dokploy does not have', async () => {
			dokploy({ 'registry.one': 404 });

			await expect(registryUseCommand({ registryId: 'nope' })).rejects.toThrow(
				'Registry not found: nope',
			);
			expect(await getDokployRegistryId()).toBeUndefined();
		});
	});
});
