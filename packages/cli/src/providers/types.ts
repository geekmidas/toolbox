/**
 * Providers: what creates the thing a construct is backed by, on a stage.
 *
 * The manifest says a bucket exists (`ObjectStorage`); `deploy.<kind>.<stage>`
 * says what backs it there. A stage that names a provider has gkm *create*
 * the backing resource — when it holds the account's provisioning
 * credentials — and write the connection value into the stage's secrets,
 * where every deploy reads it as if it had been set by hand. A stage that
 * names none is `external`: the value is yours to set, as it always was.
 *
 * | Part                     | What it is                                              |
 * | ------------------------ | ------------------------------------------------------- |
 * | provisioning credentials | What creates the resource. Never given to an app.       |
 * | `ensure()`               | Idempotent find-or-create. Records in state. Never deletes. |
 * | runtime credentials      | The keys it writes into the stage's secrets.            |
 * | `verify()`               | The cheap check every deploy runs.                      |
 *
 * The key under `deploy` is the manifest kind — `objects`, which
 * `ObjectStorage` and `FileServer` produce — so `deploy.cache` and
 * `deploy.email` slot in beside it with providers of their own.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import type { DeployIdentity } from '../deploy/identity.js';
import type { ResourceRecord } from '../deploy/StateStore.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** The manifest kinds a stage can name a provider for. */
export const PROVIDER_KINDS = ['objects'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** A provider's own entry: `{ provider: 's3', … }`. */
export interface ProviderConfig {
	provider: string;
}

/**
 * One stage's entry under `deploy.<kind>`:
 *
 * - `'external'` — the default: the stage's secrets hold the key, set by you.
 * - `{ provider, … }` — that provider creates the resource and writes the key.
 * - `false` — the stage has none of this kind; a construct of it is refused.
 */
export type StageProviderEntry<C extends ProviderConfig = ProviderConfig> =
	| 'external'
	| C
	| false;

/** One change `ensure()` makes, or — in a dry run — would make. */
export interface ProvisionAction {
	/** The construct it is for. */
	construct: string;
	/** What it acts on: `bucket acme-shop-prod-uploads`. */
	resource: string;
	/** What it does: `create`, `set CORS (2 origins)`. */
	change: string;
}

/** The stage's provisioning record, as `ensure()` reads and writes it. */
export interface ProvisionState {
	/** A resource recorded by an earlier run. */
	record(key: string): ResourceRecord | undefined;
	/** About to be created — written before the call that creates it. */
	pending(entry: StateEntry): Promise<void>;
	/** Exists, as `id`. */
	ready(entry: StateEntry, id: string): Promise<void>;
	/** When the stage was last deployed, for a rotation to know it was. */
	readonly lastDeployedAt?: string;
}

export interface StateEntry {
	/** `<type>:<name>`, unique within the stage. */
	key: string;
	type: string;
	data?: Record<string, unknown>;
}

/** What `ensure()` is handed. */
export interface EnsureContext<C extends ProviderConfig, K> {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	/** Each owner's runnables' edges, from discovery. */
	runnables: Readonly<Record<string, readonly string[]>>;
	stage: string;
	identity: DeployIdentity;
	config: C;
	/** The provisioning credentials {@link ResourceProvider.credentials} found. */
	credential: K;
	/** The stage's secrets as they are now, by key. */
	secrets: Readonly<Record<string, string>>;
	state: ProvisionState;
	dryRun: boolean;
	/** `--rotate-keys`: issue each runtime key a successor. */
	rotateKeys: boolean;
	/** `--retire-old-keys`: delete a rotated-out key without waiting for a deploy. */
	retireOldKeys: boolean;
	/**
	 * Runs `apply` and records `action` — or, in a dry run, only records it.
	 * Every write to the provider's account goes through here.
	 */
	change(action: ProvisionAction, apply: () => Promise<void>): Promise<void>;
	/**
	 * Writes keys into the stage's secrets now — not at the end of the run, so
	 * a secret the account shows only once is kept the moment it exists. A dry
	 * run writes nothing.
	 */
	writeSecrets(values: Record<string, string>): Promise<void>;
	log(line: string): void;
}

/** What `verify()` is handed. */
export interface VerifyContext<C extends ProviderConfig> {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	config: C;
	/** The stage's secrets, by key. */
	secrets: Readonly<Record<string, string>>;
}

/** Where a provider's provisioning credentials are looked for. */
export interface CredentialLookup {
	stage: string;
	/** `--profile`, when given. */
	profile?: string;
	env: NodeJS.ProcessEnv;
	/** The CLI's home, for stored logins. */
	home?: string;
}

/**
 * A provider. `C` is its config entry, `K` its provisioning credential.
 *
 * Built-ins are registered in `providers/registry.ts`, the way a deploy
 * target's built-ins are.
 */
export interface ResourceProvider<
	C extends ProviderConfig = ProviderConfig,
	K = unknown,
> {
	readonly kind: ProviderKind;
	/** What `provider:` names it. */
	readonly name: string;
	/**
	 * Its config entry checked: returns it, or throws a named error saying
	 * what is wrong — what the workspace schema runs.
	 */
	check(stage: string, config: ProviderConfig): C;
	/** How its provisioning credentials are supplied, for messages. */
	readonly provisioning: {
		/** The environment variables it reads. */
		env: readonly string[];
		/** A `gkm login --provider` name, where it has one. */
		login?: string;
		/** One line saying how to supply them. */
		describe: string;
	};
	/** Its provisioning credentials, or `undefined` when there are none. */
	credentials(lookup: CredentialLookup): Promise<K | undefined>;
	/** The keys it writes into the stage's secrets for these constructs. */
	runtimeKeys(manifest: ConstructManifest): string[];
	ensure(ctx: EnsureContext<C, K>): Promise<void>;
	verify(ctx: VerifyContext<C>): Promise<void>;
}
