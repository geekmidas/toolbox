import { DEPENDENCY_VERSIONS, EXPO_VERSIONS } from '../dependencies.js';
import type { TemplateOptions } from '../templates/index.js';

/**
 * The workspace's one React.
 *
 * Every frontend imports the generated API client and `@<name>/auth/client`
 * from the root, which resolve React from the root too — so a site running a
 * different React than they resolve loads two, and a hook breaks. Expo pins
 * its React to the SDK, so with a mobile app in the workspace every site runs
 * Expo's; without one, the web default.
 */
export function workspaceReact(options: TemplateOptions): string {
	return options.mobileApp ? EXPO_VERSIONS.react : DEPENDENCY_VERSIONS.react;
}

/** `react-dom` at the same version as {@link workspaceReact}. */
export function workspaceReactDom(options: TemplateOptions): string {
	return options.mobileApp
		? EXPO_VERSIONS['react-dom']
		: DEPENDENCY_VERSIONS['react-dom'];
}

/** `@types/react` for the workspace's React (see `workspaceReact`). */
export function workspaceReactTypes(options: TemplateOptions): string {
	return options.mobileApp
		? EXPO_VERSIONS['@types/react']
		: DEPENDENCY_VERSIONS['@types/react'];
}
