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
	/**
	 * The AWS account a stage deploys to, for the SST target's `sst deploy`.
	 * Handed to that one command's environment and to nothing else.
	 */
	aws: {
		/** The stage, for a provider that keeps one account per stage. */
		request: { stage: string };
		value: AwsCredential;
	};
	/**
	 * A GoDaddy Personal Access Token, for a `dns` domain whose provider is
	 * `godaddy`. Read on the machine that writes the records — never the
	 * server's.
	 */
	godaddy: {
		request: Record<never, never>;
		value: GoDaddyCredential;
	};
}

/** A GoDaddy Personal Access Token, sent as `Authorization: Bearer <token>`. */
export interface GoDaddyCredential {
	token: string;
}

/**
 * Who to act as on AWS: a named profile, or keys.
 *
 * Never both. Given both, every AWS SDK takes the keys and ignores the
 * profile, so `--profile prod` with staging's keys still exported would deploy
 * production's stack into staging's account — the reason `secretsStoreFor`
 * resolves a named profile on its own, and why this cannot express the mix.
 */
export type AwsCredential =
	| {
			/** A profile in `~/.aws/config` — keys, SSO, an assumed role. */
			profile: string;
			region?: string;
	  }
	| {
			accessKeyId: string;
			secretAccessKey: string;
			/** Present for temporary keys: an assumed role, GitHub's OIDC. */
			sessionToken?: string;
			region?: string;
	  };

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
	godaddy:
		'Set GODADDY_API_TOKEN to a Personal Access Token scoped to domains.dns:update (create one in the GoDaddy developer dashboard), or run `gkm login --provider godaddy`.',
	aws: "Set AWS_PROFILE to the stage account's profile, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN) — in CI, the keys aws-actions/configure-aws-credentials exports — or pass them through the deploy's CredentialProvider.",
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
					: kind === 'aws'
						? `No AWS credentials${target ? ` for the "${target}" stage` : ''}.`
						: kind === 'godaddy'
							? `No GoDaddy API token${target ? ` for ${target}` : ''}.`
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
 * - AWS: `AWS_PROFILE` when it is set, and then nothing else; otherwise
 *   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`. The
 *   profile winning is `secretsStoreFor`'s rule: a profile is a choice of
 *   account someone made, exported keys may be left over from another.
 *   Read here, by name, and handed only to the command that deploys — the
 *   sandbox every other step runs in passes no `AWS_*` on.
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
				case 'godaddy': {
					// The environment first, then the stored login.
					const token =
						env.GODADDY_API_TOKEN ??
						(
							await readCredentials(
								options.home ? { home: options.home } : undefined,
							)
						).godaddy?.token;
					if (!token) return undefined;
					return { token } as never;
				}
				case 'aws': {
					const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
					const where = region ? { region } : {};
					if (env.AWS_PROFILE) {
						return { profile: env.AWS_PROFILE, ...where } as never;
					}
					const accessKeyId = env.AWS_ACCESS_KEY_ID;
					const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
					if (!accessKeyId || !secretAccessKey) return undefined;
					return {
						accessKeyId,
						secretAccessKey,
						...(env.AWS_SESSION_TOKEN
							? { sessionToken: env.AWS_SESSION_TOKEN }
							: {}),
						...where,
					} as never;
				}
			}
			// A kind a target declared: nothing stored here can answer it.
			return undefined;
		},
	};
}
