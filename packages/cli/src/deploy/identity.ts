/**
 * Who a deploy is, on a target it shares with other workspaces.
 *
 * A Dokploy server is one flat namespace of projects, images and Docker
 * service names. Deploys used to identify everything they made by the
 * workspace name alone, so two workspaces called `shop` — or `Shop` and
 * `shop` — deploying to one server landed in the same project, pushed over
 * each other's images and redeployed each other's applications. A
 * `DeployIdentity` is what a deploy names and claims its resources by instead.
 */

import { kebabCase, scopedName } from '@geekmidas/manifest';

export interface DeployIdentity {
	/**
	 * Whose deploy this is — an organisation, a team, a repository. Two
	 * workspaces with the same name are told apart by it. Defaults to the
	 * kebab-cased workspace name; set `deploy.namespace` to choose one.
	 */
	readonly namespace: string;
	/** The workspace name as the target spells it: lowercase, `[a-z0-9-]`. */
	readonly project: string;
	readonly stage: string;
	/**
	 * `<namespace>/<project>`: what a Dokploy project is claimed by.
	 *
	 * The stage is not part of it because one Dokploy project holds every stage
	 * of a workspace, each as an environment — the key has to be the same from
	 * every stage that deploys into it.
	 */
	readonly key: string;
	/**
	 * The prefix every name on the target carries: the project alone in the
	 * default namespace, `<namespace>-<project>` in any other.
	 *
	 * The default adds nothing so that a workspace that never set a namespace
	 * keeps the names it was already deployed under — a Postgres is found by
	 * its name, and a new name would be a new, empty database.
	 */
	readonly scope: string;
}

/** A namespace that cannot be part of a Dokploy name or an image path. */
export class DeployNamespaceInvalid extends Error {
	constructor(readonly namespace: string) {
		super(
			`deploy.namespace '${namespace}' is not usable as a name: use lowercase letters, digits and single '-' between them (e.g. 'acme' or 'acme-platform') in gkm.config.ts.`,
		);
		this.name = 'DeployNamespaceInvalid';
	}
}

/** A workspace name with nothing a target can name a resource by. */
export class DeployProjectNameInvalid extends Error {
	constructor(readonly workspaceName: string) {
		super(
			`The workspace name '${workspaceName}' has no letters or digits to name deployed resources by. Set "name" in gkm.config.ts.`,
		);
		this.name = 'DeployProjectNameInvalid';
	}
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lowercase `[a-z0-9-]`, runs of anything else collapsed to one `-`: valid as
 * a Docker image path component, a Docker service name and a Dokploy name.
 */
function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** The namespace a workspace is in when it does not name one. */
export function defaultNamespace(workspaceName: string): string {
	return slug(kebabCase(workspaceName));
}

/** What an identity is derived from: a workspace's name and namespace. */
export interface IdentitySource {
	name: string;
	deploy?: { namespace?: string };
}

export function deployIdentity(
	workspace: IdentitySource,
	stage: string,
): DeployIdentity {
	// Lowercased rather than kebab-cased: the names a workspace was already
	// deployed under were `${stage}-${name}`.toLowerCase(), and this has to
	// reproduce them for the databases it finds by name.
	const project = slug(workspace.name);
	if (!project) throw new DeployProjectNameInvalid(workspace.name);

	const fallback = defaultNamespace(workspace.name);
	const namespace = workspace.deploy?.namespace ?? fallback;
	if (!NAME.test(namespace)) throw new DeployNamespaceInvalid(namespace);

	return {
		namespace,
		project,
		stage,
		key: `${namespace}/${project}`,
		scope: namespace === fallback ? project : `${namespace}-${project}`,
	};
}

/**
 * The token a Dokploy project's description carries to say which identity
 * created it. A project with the right name and no marker belongs to someone
 * else, and a deploy never adopts it.
 */
export function ownershipMarker(identity: DeployIdentity): string {
	return `gkm:${identity.key}`;
}

/** Whether a project description carries `identity`'s marker. */
export function isOwnedBy(
	description: string | null | undefined,
	identity: DeployIdentity,
): boolean {
	const marker = ownershipMarker(identity);
	return (description ?? '').split(/\s+/).includes(marker);
}

/** Any `gkm:` marker a description carries — whoever's it is. */
export function markerOf(
	description: string | null | undefined,
): string | undefined {
	return (description ?? '').split(/\s+/).find((t) => t.startsWith('gkm:'));
}

/** What the Dokploy project is called. */
export function projectName(identity: DeployIdentity): string {
	return identity.scope;
}

/**
 * The repository an app's image is pushed to, below the registry:
 * `<namespace>/<project>-<app>`.
 *
 * The namespace is a path segment of its own so that a registry that maps
 * paths to owners (an organisation's packages, a Harbor project) can grant it
 * as one; the app is joined to the project so the two read as one name.
 */
export function imageName(identity: DeployIdentity, app: string): string {
	return `${identity.namespace}/${identity.project}-${slug(kebabCase(app))}`;
}

/** The full image ref an app is built, pushed and deployed as. */
export function imageRef(
	identity: DeployIdentity,
	app: string,
	registry: string | undefined,
	tag: string,
): string {
	const name = imageName(identity, app);
	return registry
		? `${registry.replace(/\/+$/, '')}/${name}:${tag}`
		: `${name}:${tag}`;
}

/**
 * What one application is called on the target.
 *
 * The same rule the constructs use, through the same `scopedName`, scoped by
 * the stage and the identity: the application beside
 * `production-kitchen-sink-database` is `production-kitchen-sink-api`. A
 * Dokploy application's name is also its Docker service name, which is unique
 * on the whole server, so the namespace has to be in it too — `acme`'s and
 * `globex`'s `shop` would otherwise both run `production-shop-api`.
 *
 * The app id is dropped when it repeats the project, so a project named for its
 * one application is `production-kitchen-sink` rather than
 * `production-kitchen-sink-kitchen-sink`.
 */
export function applicationName(identity: DeployIdentity, app: string): string {
	return slug(app) === identity.project
		? `${identity.stage}-${identity.scope}`
		: scopedName([identity.stage, identity.scope], app);
}
