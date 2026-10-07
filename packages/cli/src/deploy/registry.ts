/**
 * Which Dokploy registry a stage's images are pulled through.
 *
 * It used to be one id stored per machine (`~/.gkm/credentials.json`), and
 * when that was empty, the first registry Dokploy listed — so an image could be
 * deployed with credentials for a registry nobody chose, and two workspaces
 * deployed from one machine shared whichever was stored last. The id is now
 * kept in the stage's state, and found only from what the workspace
 * configured.
 */

import {
	type DokployApi,
	DokployApiError,
	type DokployRegistry,
} from './dokploy-api';

/** There is nowhere to push images to, so Dokploy has nothing to pull. */
export class RegistryNotConfigured extends Error {
	constructor(readonly stage: string) {
		super(
			`Deploying '${stage}' needs a container registry: Dokploy pulls each app's image from one. ` +
				`Set deploy.registry in gkm.config.ts (e.g. 'ghcr.io/acme'), and deploy.dokploy.registryId if Dokploy already holds that registry's credentials.`,
		);
		this.name = 'RegistryNotConfigured';
	}
}

/** `deploy.dokploy.registryId` names a registry Dokploy does not have. */
export class RegistryNotFound extends Error {
	constructor(readonly registryId: string) {
		super(
			`deploy.dokploy.registryId '${registryId}' is not a registry on this Dokploy server. ` +
				`Find the right id under Settings → Docker Registry in Dokploy and set it in gkm.config.ts, or remove it to have deploy find the registry by its URL.`,
		);
		this.name = 'RegistryNotFound';
	}
}

/** More than one Dokploy registry serves the configured registry. */
export class RegistryAmbiguous extends Error {
	constructor(
		readonly registry: string,
		readonly registryIds: readonly string[],
	) {
		super(
			`Dokploy has ${registryIds.length} registries for '${registry}' (${registryIds.join(', ')}). ` +
				`Set deploy.dokploy.registryId in gkm.config.ts to the one this workspace pushes with.`,
		);
		this.name = 'RegistryAmbiguous';
	}
}

/** `https://ghcr.io/acme/` → `{ host: 'ghcr.io', path: 'acme' }`. */
function parts(url: string): { host: string; path: string } {
	const [host = '', ...path] = url
		.replace(/^[a-z]+:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase()
		.split('/');
	return { host, path: path.join('/') };
}

/**
 * The Dokploy registries that serve `registry`: the same host, and — where
 * Dokploy's own entry names one — the same path.
 */
function serving(
	registries: readonly DokployRegistry[],
	registry: string,
): DokployRegistry[] {
	const wanted = parts(registry);
	const sameHost = registries.filter(
		(r) => parts(r.registryUrl ?? '').host === wanted.host,
	);
	if (sameHost.length <= 1) return sameHost;

	// Several on one host (two organisations on ghcr.io): the one whose URL or
	// image prefix is the configured path is the one meant.
	return sameHost.filter((r) => {
		const own = parts(r.registryUrl ?? '');
		const path = own.path || (r.imagePrefix ?? '').toLowerCase();
		return path === wanted.path;
	});
}

/** `registry.one`, or `null` when Dokploy says it has no such registry. */
async function registryById(
	api: DokployApi,
	registryId: string,
): Promise<DokployRegistry | null> {
	try {
		return (await api.getRegistry(registryId)) ?? null;
	} catch (error) {
		// Only Dokploy's own answer means "not there"; a timeout or a refused
		// connection is not a reason to pick another registry.
		if (error instanceof DokployApiError) return null;
		throw error;
	}
}

export interface ResolveRegistryOptions {
	stage: string;
	/** `deploy.registry`: where images are pushed. */
	registry: string | undefined;
	/** `deploy.dokploy.registryId`: a registry chosen by id. */
	configuredId: string | undefined;
	/** The id the stage's state recorded on its last deploy. */
	stateId: string | undefined;
	/** Creates the registry in Dokploy when it has none for `registry`. */
	create: (registry: string) => Promise<DokployRegistry>;
	log?: (message: string) => void;
}

/**
 * The registry id for a stage, in order: the configured id, the one in the
 * stage's state, the one Dokploy has for the configured registry URL, and
 * otherwise a new one. Never a registry the workspace did not point at.
 */
export async function resolveRegistry(
	api: DokployApi,
	options: ResolveRegistryOptions,
): Promise<DokployRegistry> {
	const { stage, registry, configuredId, stateId, log = () => {} } = options;

	if (!registry) throw new RegistryNotConfigured(stage);

	if (configuredId) {
		const configured = await registryById(api, configuredId);
		if (!configured) throw new RegistryNotFound(configuredId);
		return configured;
	}

	if (stateId) {
		const known = await registryById(api, stateId);
		if (known) return known;
		log(`   ⚠ The stage's registry ${stateId} no longer exists in Dokploy`);
	}

	const matches = serving(await api.listRegistries(), registry);
	if (matches.length > 1) {
		throw new RegistryAmbiguous(
			registry,
			matches.map((r) => r.registryId),
		);
	}
	if (matches[0]) return matches[0];

	return options.create(registry);
}
