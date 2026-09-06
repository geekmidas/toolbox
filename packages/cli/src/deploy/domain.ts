import { getPublicEnvPrefix } from '../workspace/index.js';
import type {
	DokployWorkspaceConfig,
	NormalizedAppConfig,
} from '../workspace/types.js';

/**
 * Resolve the hostname for an app based on stage configuration.
 *
 * Domain resolution priority:
 * 1. Explicit app.domain override (string or stage-specific)
 * 2. Default pattern based on app type:
 *    - Main frontend app gets base domain (e.g., 'myapp.com')
 *    - Other apps get prefixed domain (e.g., 'api.myapp.com')
 *
 * @param appName - The name of the app
 * @param app - The normalized app configuration
 * @param stage - The deployment stage (e.g., 'production', 'development')
 * @param dokployConfig - Dokploy workspace configuration with domain mappings
 * @param isMainFrontend - Whether this is the main frontend app
 * @returns The resolved hostname for the app
 * @throws Error if no domain configuration is found for the stage
 */
export function resolveHost(
	appName: string,
	app: NormalizedAppConfig,
	stage: string,
	dokployConfig: DokployWorkspaceConfig | undefined,
	isMainFrontend: boolean,
): string {
	// 1. Check for explicit app domain override
	if (app.domain) {
		if (typeof app.domain === 'string') {
			return app.domain;
		}
		if (app.domain[stage]) {
			return app.domain[stage]!;
		}
	}

	// 2. Get base domain for this stage
	const baseDomain = dokployConfig?.domains?.[stage];
	if (!baseDomain) {
		throw new Error(
			`No domain configured for stage "${stage}". ` +
				`Add deploy.dokploy.domains.${stage} to gkm.config.ts`,
		);
	}

	// 3. Main frontend app gets base domain, others get prefix
	if (isMainFrontend) {
		return baseDomain;
	}

	return `${appName}.${baseDomain}`;
}

/**
 * Which site the base domain points at.
 *
 * Three rules, in order, and the last one is the point:
 *
 * 1. **One site** — it is the root. Unambiguous, so nothing has to be said.
 * 2. **Named `web`** — the convention wins, because people already rely on it.
 * 3. **Declared `root: true`** — the site says so itself.
 *
 * Anything else throws. It used to take the *first* `type: 'web'` it iterated,
 * and that object is built from the manifest, which is built in glob traversal
 * order — so two sites with neither named `web` meant renaming a file could
 * move the production root domain, silently. The same shape as
 * `CacheIsAmbiguous`: unambiguous with one and arbitrary with two, so two is an
 * error rather than a coin toss.
 *
 * @throws {AmbiguousRootSite} when several sites could be the root and none says it is
 */
export function isMainFrontendApp(
	appName: string,
	app: NormalizedAppConfig,
	allApps: Record<string, NormalizedAppConfig>,
): boolean {
	if (app.type !== 'web') return false;

	const sites = Object.entries(allApps).filter(([, a]) => a.type === 'web');

	// 1. The only site there is.
	if (sites.length === 1) return true;

	// 2. The convention.
	const named = sites.filter(([name]) => name === 'web');
	if (named.length > 0) return appName === 'web';

	// 3. What a site declared about itself.
	const declared = sites.filter(([, a]) => a.root === true);
	if (declared.length === 1) return declared[0]![0] === appName;

	throw new AmbiguousRootSite(
		sites.map(([name]) => name),
		declared.length > 1,
	);
}

/** Several sites could hold the base domain, and none of them says it does. */
export class AmbiguousRootSite extends Error {
	constructor(
		readonly sites: readonly string[],
		readonly tooMany = false,
	) {
		super(
			tooMany
				? `More than one site declares \`root: true\` — ${sites.join(', ')}. ` +
						`The base domain points at one of them.`
				: `${sites.length} sites and nothing says which holds the base ` +
						`domain: ${sites.join(', ')}. Name one of them \`web\`, or ` +
						`declare \`root: true\` on the one the base domain points at. ` +
						`It used to be whichever the glob reached first, which is not a ` +
						`thing to decide a production hostname.`,
		);
		this.name = 'AmbiguousRootSite';
	}
}

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
	const prefix = getPublicEnvPrefix(app);
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
	const prefix = getPublicEnvPrefix(app);
	if (!prefix) return [];
	return app.dependencies.map((dep) => `${prefix}${dep.toUpperCase()}_URL`);
}
