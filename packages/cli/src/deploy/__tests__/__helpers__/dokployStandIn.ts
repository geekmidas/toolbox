/**
 * A stand-in Dokploy for deploy specs, served through MSW.
 *
 * It keeps state — projects, environments, applications, registries, domains —
 * so a second deploy meets what the first one created, the way a real redeploy
 * does. Shared so every spec that deploys talks to the same Dokploy, rather
 * than each growing its own idea of what the API answers.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import type { SetupServerApi } from 'msw/node';

// Local, so the server's address resolves without a network: DNS records
// point at it.
export const ENDPOINT = 'http://localhost:3999';

/** The Dokploy this deploy talks to, as data. */
export interface Dokploy {
	projects: {
		projectId: string;
		name: string;
		description: string | null;
		environments: {
			environmentId: string;
			name: string;
			applications: {
				applicationId: string;
				name: string;
				appName: string;
			}[];
			postgres: Postgres[];
		}[];
	}[];
	registries: {
		registryId: string;
		registryName: string;
		registryUrl: string;
		username?: string;
	}[];
	domains: { domainId: string; host: string; applicationId: string }[];
	env: Record<string, string>;
	images: Record<string, string>;
	deployed: string[];
	/** Hosts whose domain creation fails. */
	failDomains: string[];
	/** The environment name `project.create` makes, as Dokploy does. */
	defaultEnvironment: string;
	/** How `domain.validateDomain` answers, per host; unlisted hosts fail. */
	validity: Record<string, boolean>;
	/** Why publishing a port is refused. */
	portRefusal: (port: number) => string;
	/** Every external port a publish was attempted on, in order. */
	savedPorts: number[];
	/** Every create Dokploy carried out, in order — `application:<name>`. */
	created: string[];
	/**
	 * The create after which the deploy's connection dies: Dokploy has made
	 * the resource, and the deploy never hears back.
	 */
	dieAfterCreate?: number;
}

export interface Postgres {
	postgresId: string;
	name: string;
	appName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	externalPort: number | null;
}

let ids = 0;
const id = (prefix: string) => `${prefix}_${++ids}`;

/** A Dokploy with one registry for ghcr.io and nothing else on it. */
export function emptyDokploy(stage: string): Dokploy {
	return {
		projects: [],
		registries: [
			{ registryId: 'reg_1', registryName: 'GHCR', registryUrl: 'ghcr.io' },
		],
		domains: [],
		env: {},
		images: {},
		deployed: [],
		failDomains: [],
		defaultEnvironment: stage,
		portRefusal: (port) => `Port ${port} is already in use`,
		validity: {},
		savedPorts: [],
		created: [],
	};
}

/** Answers Dokploy's API on `server` from whatever `current()` holds. */
export function serveDokploy(
	server: SetupServerApi,
	current: () => Dokploy,
): void {
	const body = async (request: Request) =>
		(await request.json()) as Record<string, string>;
	const environments = () => current().projects.flatMap((p) => p.environments);
	const postgres = (postgresId: string) =>
		environments()
			.flatMap((e) => e.postgres)
			.find((p) => p.postgresId === postgresId)!;
	const application = (applicationId: string) =>
		environments()
			.flatMap((e) => e.applications)
			.find((a) => a.applicationId === applicationId);

	/** Records a create; a response that never arrives when it is the fatal one. */
	const made = (what: string) => {
		current().created.push(what);
		return current().created.length === current().dieAfterCreate
			? HttpResponse.json({ message: 'connection reset' }, { status: 502 })
			: undefined;
	};

	server.use(
		http.get(`${ENDPOINT}/api/project.all`, () =>
			HttpResponse.json(
				current().projects.map(({ projectId, name, description }) => ({
					projectId,
					name,
					description,
				})),
			),
		),
		http.get(`${ENDPOINT}/api/project.one`, ({ request }) => {
			const projectId = new URL(request.url).searchParams.get('projectId');
			const found = current().projects.find((p) => p.projectId === projectId);
			return found
				? HttpResponse.json(found)
				: HttpResponse.json({ message: 'Project not found' }, { status: 404 });
		}),
		http.post(`${ENDPOINT}/api/project.update`, async ({ request }) => {
			const { projectId, name, description } = await body(request);
			const found = current().projects.find((p) => p.projectId === projectId)!;
			found.name = name!;
			found.description = description!;
			return HttpResponse.json(found);
		}),
		http.post(`${ENDPOINT}/api/project.create`, async ({ request }) => {
			const { name, description } = await body(request);
			const environment = {
				environmentId: id('env'),
				name: current().defaultEnvironment,
				applications: [],
				postgres: [],
			};
			const project = {
				projectId: id('proj'),
				name: name!,
				description: description ?? null,
				environments: [environment],
			};
			current().projects.push(project);
			return (
				made(`project:${project.name}`) ??
				HttpResponse.json({ project, environment })
			);
		}),
		http.post(`${ENDPOINT}/api/environment.create`, async ({ request }) => {
			const { projectId, name } = await body(request);
			const environment = {
				environmentId: id('env'),
				name: name!,
				applications: [],
				postgres: [],
			};
			current()
				.projects.find((p) => p.projectId === projectId)!
				.environments.push(environment);
			return (
				made(`environment:${environment.name}`) ??
				HttpResponse.json(environment)
			);
		}),
		http.get(`${ENDPOINT}/api/registry.all`, () =>
			HttpResponse.json(current().registries),
		),
		http.post(`${ENDPOINT}/api/registry.create`, async ({ request }) => {
			const { registryName, registryUrl, username } = await body(request);
			const created = {
				registryId: id('reg'),
				registryName: registryName!,
				registryUrl: registryUrl!,
				username: username!,
			};
			current().registries.push(created);
			return (
				made(`registry:${created.registryName}`) ?? HttpResponse.json(created)
			);
		}),
		http.get(`${ENDPOINT}/api/registry.one`, ({ request }) => {
			const registryId = new URL(request.url).searchParams.get('registryId');
			const found = current().registries.find(
				(r) => r.registryId === registryId,
			);
			return found
				? HttpResponse.json(found)
				: HttpResponse.json({ message: 'Registry not found' }, { status: 404 });
		}),
		http.post(`${ENDPOINT}/api/application.create`, async ({ request }) => {
			const { name, environmentId, appName } = await body(request);
			const created = {
				applicationId: id('app'),
				name: name!,
				appName: appName!,
			};
			environments()
				.find((e) => e.environmentId === environmentId)!
				.applications.push(created);
			return made(`application:${created.name}`) ?? HttpResponse.json(created);
		}),
		http.get(`${ENDPOINT}/api/application.one`, ({ request }) => {
			const found = application(
				new URL(request.url).searchParams.get('applicationId')!,
			);
			return found
				? HttpResponse.json(found)
				: HttpResponse.json({ message: 'Not found' }, { status: 404 });
		}),
		http.post(
			`${ENDPOINT}/api/application.saveDockerProvider`,
			async ({ request }) => {
				const { applicationId, dockerImage } = await body(request);
				current().images[applicationId!] = dockerImage!;
				return HttpResponse.json({});
			},
		),
		http.post(
			`${ENDPOINT}/api/application.saveEnvironment`,
			async ({ request }) => {
				const { applicationId, env } = await body(request);
				current().env[applicationId!] = env!;
				return HttpResponse.json({});
			},
		),
		http.post(`${ENDPOINT}/api/application.deploy`, async ({ request }) => {
			current().deployed.push((await body(request)).applicationId!);
			return HttpResponse.json({});
		}),
		http.get(`${ENDPOINT}/api/domain.byApplicationId`, ({ request }) => {
			const applicationId = new URL(request.url).searchParams.get(
				'applicationId',
			);
			return HttpResponse.json(
				current().domains.filter((d) => d.applicationId === applicationId),
			);
		}),
		http.post(`${ENDPOINT}/api/domain.create`, async ({ request }) => {
			const { host, applicationId } = await body(request);
			if (current().failDomains.includes(host!)) {
				return HttpResponse.json(
					{ message: 'Domain already in use' },
					{ status: 409 },
				);
			}
			const domain = {
				domainId: id('dom'),
				host: host!,
				applicationId: applicationId!,
			};
			current().domains.push(domain);
			return made(`domain:${domain.host}`) ?? HttpResponse.json(domain);
		}),
		http.post(`${ENDPOINT}/api/domain.validateDomain`, async ({ request }) => {
			const { domain } = await body(request);
			const isValid = current().validity[domain!];
			return isValid === undefined
				? HttpResponse.json({ message: 'Traefik unreachable' }, { status: 502 })
				: HttpResponse.json({ isValid, resolvedIp: '127.0.0.1' });
		}),
		http.post(`${ENDPOINT}/api/postgres.create`, async ({ request }) => {
			const { name, appName, databaseName, environmentId } =
				await body(request);
			// Unpublished, as Dokploy creates one.
			const created = {
				postgresId: id('pg'),
				name: name!,
				appName: appName!,
				databaseName: databaseName!,
				databaseUser: 'postgres',
				databasePassword: 'master',
				externalPort: null,
			};
			environments()
				.find((e) => e.environmentId === environmentId)!
				.postgres.push(created);
			return HttpResponse.json(created);
		}),
		http.get(`${ENDPOINT}/api/postgres.one`, ({ request }) =>
			HttpResponse.json(
				postgres(new URL(request.url).searchParams.get('postgresId')!),
			),
		),
		http.post(
			`${ENDPOINT}/api/postgres.saveExternalPort`,
			async ({ request }) => {
				const { externalPort } = (await request.json()) as {
					externalPort: number;
				};
				current().savedPorts.push(externalPort);
				return HttpResponse.json(
					{ message: current().portRefusal(externalPort) },
					{ status: 400 },
				);
			},
		),
	);
}

/** What a spec may vary about the `shop` workspace. */
export interface ShopWorkspace {
	/** `deploy.registry`; `false` leaves it out. */
	registry?: string | false;
	/** The `apps` block, as source. */
	apps?: string;
}

/**
 * A workspace called `shop` at `root`: an API, a Next.js site that calls it,
 * and an Expo app, deploying `stage` and `staging` to the stand-in.
 */
export function writeShopWorkspace(
	root: string,
	stage: string,
	extra: ShopWorkspace = {},
): void {
	const registry =
		extra.registry === false
			? ''
			: `registry: '${extra.registry ?? 'ghcr.io/acme'}',`;
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ name: 'shop', private: true, type: 'module' }),
	);
	writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
	for (const app of ['api', 'web', 'app']) {
		mkdirSync(join(root, 'apps', app), { recursive: true });
		writeFileSync(
			join(root, 'apps', app, 'package.json'),
			// ES modules, as every scaffold is: the sniffer swaps envkit in
			// through an import hook, which a CommonJS require never meets.
			JSON.stringify({ name: `@shop/${app}`, type: 'module' }),
		);
	}
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['${stage}', 'staging'] },
  apps: ${
		extra.apps ??
		`{
    api: { type: 'backend', path: 'apps/api', port: 3000 },
    web: {
      type: 'web',
      path: 'apps/web',
      port: 3001,
      framework: 'nextjs',
      dependencies: ['api'],
    },
    app: { type: 'mobile', path: 'apps/app', port: 8081, framework: 'expo' },
  }`
	},
  deploy: {
    default: 'dokploy',
    domains: { ${stage}: 'shop.example.com', staging: 'staging.shop.example.com' },
    ${registry}
    dokploy: {
      endpoint: '${ENDPOINT}',
    },
  },
});
`,
	);
}
