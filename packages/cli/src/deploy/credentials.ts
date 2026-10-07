/**
 * How a deploy gets the credentials it acts with.
 *
 * `deploy()` never prompts and never reads a terminal: it asks a
 * `CredentialProvider` and, when the provider has nothing, stops with
 * `MissingCredential` naming what it needed and how to supply it. Whether to
 * ask a person, read a vault or fail is the caller's decision — `gkm deploy`
 * prompts at a terminal and stores what was typed; a CI job sets the
 * environment; a host passes its own provider.
 */

import { readCredentials } from '../auth/credentials';

/**
 * What each kind of credential is asked for with, and what it is.
 *
 * A target that needs a kind the CLI does not know declares it by augmenting
 * this interface, and lists it in its `credentials`:
 *
 * ```ts
 * declare module '@geekmidas/cli/target' {
 *   interface CredentialKinds {
 *     fly: { request: { org: string }; value: { token: string } };
 *   }
 * }
 * ```
 */
export interface CredentialKinds {
	/** The Dokploy API a stage deploys through. */
	dokploy: {
		/** `deploy.dokploy.endpoint`, when the config names one. */
		request: { endpoint?: string };
		value: { endpoint: string; token: string };
	};
	/**
	 * A container registry login, for Dokploy to pull with. Asked for only when
	 * Dokploy has no registry for `deploy.registry` and one has to be
	 * created.
	 */
	registry: {
		/** `deploy.registry`. */
		request: { url: string };
		value: { username: string; password: string };
	};
}

export type CredentialKind = keyof CredentialKinds;

/** What a deploy asks a provider for. */
export type CredentialRequest<K extends CredentialKind = CredentialKind> = {
	[P in K]: { kind: P } & CredentialKinds[P]['request'];
}[K];

/** What a provider answers with. */
export type Credential<K extends CredentialKind> = CredentialKinds[K]['value'];

export interface CredentialProvider {
	/**
	 * The credential `request` asks for, or `undefined` when this provider has
	 * none — the deploy then raises {@link MissingCredential}.
	 */
	get<K extends CredentialKind>(
		request: CredentialRequest<K>,
		options?: { signal?: AbortSignal },
	): Promise<Credential<K> | undefined>;
}

/**
 * How to supply each kind the CLI knows, for the error that says it is
 * missing. A target's own kinds are its to explain.
 */
const HOW_TO_PROVIDE: Partial<Record<CredentialKind, string>> = {
	dokploy:
		"Set DOKPLOY_API_TOKEN (and DOKPLOY_ENDPOINT, or deploy.dokploy.endpoint in gkm.config.ts), run `gkm login --provider dokploy`, or pass them through the deploy's CredentialProvider.",
	registry:
		'Add the registry in Dokploy (Settings → Docker Registry) and set deploy.dokploy.registryId, set DOCKER_REGISTRY_USERNAME and DOCKER_REGISTRY_PASSWORD, or run `gkm deploy` at a terminal to be asked for them.',
};

/** A deploy needed a credential, and its provider had none. */
export class MissingCredential extends Error {
	constructor(
		readonly kind: CredentialKind,
		/** What it was for: the Dokploy endpoint or the registry URL. */
		readonly target: string | undefined,
		/** How to supply it. */
		readonly howToProvide: string = HOW_TO_PROVIDE[kind] ??
			"Pass it through the deploy's CredentialProvider.",
	) {
		const what =
			kind === 'dokploy'
				? `No Dokploy credentials${target ? ` for ${target}` : ''}.`
				: kind === 'registry'
					? `Dokploy has no registry for ${target ?? 'the configured registry'}, and there are no credentials to create one with.`
					: `No "${String(kind)}" credentials${target ? ` for ${target}` : ''}.`;
		super(`${what} ${howToProvide}`);
		this.name = 'MissingCredential';
	}
}

/** Whatever was asked for, from the first provider that has it. */
export function chainCredentials(
	...providers: CredentialProvider[]
): CredentialProvider {
	return {
		async get(request, options) {
			for (const provider of providers) {
				const found = await provider.get(request, options);
				if (found) return found;
			}
			return undefined;
		},
	};
}

export interface StoredCredentialsOptions {
	/** Where to read the variables from. Defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/**
	 * The CLI's home, whose `credentials.json` holds stored logins. Defaults
	 * to `GKM_HOME`, else `~/.gkm`.
	 */
	home?: string;
}

/**
 * Credentials from the environment, then from what `gkm login` stored. What
 * `deploy()` uses when it is handed no provider.
 *
 * - Dokploy: `DOKPLOY_API_TOKEN` / `DOKPLOY_ENDPOINT`, each falling back to
 *   the stored login, and the endpoint finally to `deploy.dokploy.endpoint`.
 *   Each half is read on its own: a token is a secret and belongs in the
 *   environment, an endpoint is configuration and belongs in the config.
 * - Registry: `DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`.
 */
export function storedCredentials(
	options: StoredCredentialsOptions = {},
): CredentialProvider {
	const env = options.env ?? process.env;

	return {
		async get(asked) {
			// The union, so a switch on `kind` narrows it: `K` itself never is.
			const request = asked as CredentialRequest;
			switch (request.kind) {
				case 'dokploy': {
					const stored = (
						await readCredentials(
							options.home ? { home: options.home } : undefined,
						)
					).dokploy;
					const token = env.DOKPLOY_API_TOKEN ?? stored?.token;
					const endpoint =
						env.DOKPLOY_ENDPOINT ?? stored?.endpoint ?? request.endpoint;
					if (!token || !endpoint) return undefined;
					return { endpoint: endpoint.replace(/\/$/, ''), token } as never;
				}
				case 'registry': {
					const username = env.DOCKER_REGISTRY_USERNAME;
					const password = env.DOCKER_REGISTRY_PASSWORD;
					if (!username || !password) return undefined;
					return { username, password } as never;
				}
			}
			// A kind a target declared: nothing stored here can answer it.
			return undefined;
		},
	};
}
