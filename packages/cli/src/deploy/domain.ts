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
 * Determine if an app is the "main" frontend (gets base domain).
 *
 * An app is considered the main frontend if:
 * 1. It's named 'web' and is a frontend type
 * 2. It's the first frontend app in the apps list
 *
 * @param appName - The name of the app to check
 * @param app - The app configuration
 * @param allApps - All apps in the workspace
 * @returns True if this is the main frontend app
 */
export function isMainFrontendApp(
	appName: string,
	app: NormalizedAppConfig,
	allApps: Record<string, NormalizedAppConfig>,
): boolean {
	if (app.type !== 'web') {
		return false;
	}

	// App named 'web' is always main
	if (appName === 'web') {
		return true;
	}

	// Otherwise, check if this is the first frontend
	for (const [name, a] of Object.entries(allApps)) {
		if (a.type === 'web') {
			return name === appName;
		}
	}

	return false;
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
