/**
 * What of the host's environment a local sandbox passes on.
 *
 * An allowlist, not a denylist: a credential's variable has any name its
 * owner chose (`DOKPLOY_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `MY_VAULT_TOKEN`), so
 * the only safe default is to name what a program needs to *run* and pass
 * nothing else.
 */

/**
 * Variables a command needs to find programs, write temp files, print in the
 * user's locale and reach the network through the host's proxy — and nothing
 * that authenticates as anyone.
 *
 * Deliberately left out:
 * - `NODE_OPTIONS`: it can `--require` or `--import` code into every node
 *   process, and CI often holds `--import tsx` there. A step that needs a
 *   loader passes its own.
 * - `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `npm_config_*`: registry tokens
 *   (`actions/setup-node` writes `NODE_AUTH_TOKEN`), which is why there is no
 *   `NODE_*` wildcard.
 * - `AWS_*`, `DOCKER_*`, `DOKPLOY_*`, `GITHUB_TOKEN`, `TURBO_TOKEN`, `GKM_*`:
 *   credentials, or where the deploy keeps them.
 * - `SHELL`, `EDITOR` and the rest of a login session: nothing here starts a
 *   shell.
 *
 * Proxies are passed: behind one, nothing installs or builds without it. A
 * proxy URL with a password in it reaches the command too — a host that keeps
 * one there and builds code it does not trust should pass a sandbox of its
 * own.
 */
export const SANDBOX_ENV_ALLOWLIST: readonly (string | RegExp)[] = [
	// Finding programs and a home to cache in.
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'TMPDIR',
	'TMP',
	'TEMP',
	// Locale and terminal: output a person reads should look the same.
	'LANG',
	'LANGUAGE',
	'TZ',
	/^LC_[A-Z]+$/,
	'TERM',
	'COLORTERM',
	'NO_COLOR',
	'FORCE_COLOR',
	'CI',
	// Node: the mode a build runs in, and the CAs a corporate network adds.
	'NODE_ENV',
	'NODE_EXTRA_CA_CERTS',
	// Package managers' own homes, so a build reuses the host's store.
	'COREPACK_HOME',
	'PNPM_HOME',
	'XDG_CACHE_HOME',
	'XDG_DATA_HOME',
	// The network, through the host's proxy.
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'NO_PROXY',
	'http_proxy',
	'https_proxy',
	'no_proxy',
	// Windows: without these, nothing starts.
	'SystemRoot',
	'SYSTEMROOT',
	'windir',
	'WINDIR',
	'ComSpec',
	'COMSPEC',
	'PATHEXT',
	'USERPROFILE',
	'APPDATA',
	'LOCALAPPDATA',
];

function allowed(name: string): boolean {
	return SANDBOX_ENV_ALLOWLIST.some((entry) =>
		typeof entry === 'string' ? entry === name : entry.test(name),
	);
}

/**
 * The allowlisted part of `source`, plus each of `extra` the host chose to
 * pass on by name.
 */
export function allowlistedEnv(
	source: NodeJS.ProcessEnv = process.env,
	extra: readonly string[] = [],
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(source)) {
		if (value === undefined) continue;
		if (allowed(name) || extra.includes(name)) env[name] = value;
	}
	return env;
}
