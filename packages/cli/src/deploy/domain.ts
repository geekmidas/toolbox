import { getPublicEnvPrefix } from '../workspace/index.js';
import { rootSite } from '../workspace/rootSite.js';
import type { DomainsConfig, NormalizedAppConfig } from '../workspace/types.js';

/** A stage was deployed that `deploy.domains` gives no domain. */
export class NoDomainForStage extends Error {
	constructor(readonly stage: string) {
		super(
			`No domain for stage "${stage}". Add it to gkm.config.ts: deploy: { domains: { ${stage}: 'example.com' } }.`,
		);
		this.name = 'NoDomainForStage';
	}
}

/**
 * The hostname an app answers on for a stage.
 *
 * 1. An explicit `app.domain` — a string, or one per stage — wins.
 * 2. Otherwise from the stage's base domain in `deploy.domains`: the root site
 *    answers on the domain itself, and every other app on
 *    `{subdomain}.{domain}` — its declaration's `subdomain`, or its own name.
 *
 * @throws {NoDomainForStage} when `deploy.domains` names no domain for it
 */
export function resolveHost(
	appName: string,
	app: NormalizedAppConfig,
	stage: string,
	domains: DomainsConfig | undefined,
	isMainFrontend: boolean,
): string {
	if (app.domain) {
		if (typeof app.domain === 'string') {
			return app.domain;
		}
		if (app.domain[stage]) {
			return app.domain[stage]!;
		}
	}

	const baseDomain = domains?.[stage];
	if (!baseDomain) throw new NoDomainForStage(stage);

	if (isMainFrontend) return baseDomain;

	return `${app.subdomain ?? appName}.${baseDomain}`;
}

/**
 * Whether this app is the site the base domain points at — see `rootSite`,
 * which the local edge asks too.
 *
 * @throws {AmbiguousRootSite} when several sites could be the root and none says it is
 */
export function isMainFrontendApp(
	appName: string,
	app: NormalizedAppConfig,
	allApps: Record<string, NormalizedAppConfig>,
): boolean {
	if (app.type !== 'web') return false;

	const sites = Object.entries(allApps)
		.filter(([, a]) => a.type === 'web')
		.map(([name, a]) => ({ name, root: a.root }));

	return rootSite(sites) === appName;
}

export { AmbiguousRootSite } from '../workspace/rootSite.js';

/**
 * Generate public URL build args for a web/mobile app based on its dependencies.
 *
 * The prefix is chosen by the app's framework (NEXT_PUBLIC_, VITE_,
 * EXPO_PUBLIC_, or none for Remix). Apps without a public prefix get no
 * build args — they should fetch URLs at runtime instead.
 *
 * @param app - The web/mobile app configuration
 * @param deployedUrls - Map of app name to deployed public URL
 * @returns Array of build args like 'NEXT_PUBLIC_API_URL=https://api.example.com'
 */
export function generatePublicUrlBuildArgs(
	app: NormalizedAppConfig,
	deployedUrls: Record<string, string>,
): string[] {
	const prefix = getPublicEnvPrefix(app.framework);
	if (!prefix) return [];

	const buildArgs: string[] = [];
	for (const dep of app.dependencies) {
		const publicUrl = deployedUrls[dep];
		if (publicUrl) {
			buildArgs.push(`${prefix}${dep.toUpperCase()}_URL=${publicUrl}`);
		}
	}

	return buildArgs;
}

/**
 * Get public URL arg names from app dependencies.
 *
 * @param app - The web/mobile app configuration
 * @returns Array of arg names like 'NEXT_PUBLIC_API_URL', or [] for frameworks
 *   without a public prefix (e.g. Remix).
 */
export function getPublicUrlArgNames(app: NormalizedAppConfig): string[] {
	const prefix = getPublicEnvPrefix(app.framework);
	if (!prefix) return [];
	return app.dependencies.map((dep) => `${prefix}${dep.toUpperCase()}_URL`);
}
