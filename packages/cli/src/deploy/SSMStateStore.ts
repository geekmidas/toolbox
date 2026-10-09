/**
 * AWS SSM Parameter Store state store.
 *
 * - `/gkm/<workspace>/<stage>/state`: the state, a SecureString.
 * - `/gkm/<workspace>/<stage>/lock`: the lock, created only if absent.
 * - `/gkm/<workspace>/<stage>/state.v1`: the v1 state, kept on migration.
 *
 * SSM has no conditional put, so a write checks the parameter's version
 * before it puts, and checks the version the put returns after: a put that
 * did not land exactly one version above the one it was based on raced
 * another writer, and raises `StateVersionConflict` rather than reporting
 * success. Both writes stay in the parameter's history.
 *
 * Size: the state is written with the Intelligent-Tiering tier, so SSM picks
 * the advanced tier (8 KB) once a value passes the standard tier's 4 KB, and a
 * document over {@link SSM_COMPRESS_OVER} bytes is stored gzipped, as `gz:`
 * and base64. Both forms are read, so a document written before either is
 * read as it was. A deploy checks before it starts that the stage's document
 * leaves room under {@link SSM_MAX_BYTES} (`assertStateRoom`); a write SSM
 * refuses anyway raises `StateRejectedBySsm` rather than the SDK's error.
 */

import {
	DeleteParameterCommand,
	GetParameterCommand,
	ParameterAlreadyExists,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
	type SSMClientConfig,
} from '@aws-sdk/client-ssm';
import type { AwsRegion } from './StateProvider';
import {
	compressBody,
	DocumentStateStore,
	decompressBody,
	type LockHolder,
	type RawState,
	type StateCapacity,
	StateLocked,
	StateRejectedBySsm,
	type StateVersion,
	StateVersionConflict,
} from './StateStore';

/** The most an advanced-tier parameter holds — what the state must fit. */
export const SSM_MAX_BYTES = 8192;
/** A body past this is stored compressed: well under the standard 4 KB. */
export const SSM_COMPRESS_OVER = 3072;

/**
 * `body` as the state parameter stores it: past the threshold, without its
 * indentation and compressed.
 */
export function packSsmBody(body: string): string {
	if (Buffer.byteLength(body) <= SSM_COMPRESS_OVER) return body;
	let compact = body;
	try {
		compact = JSON.stringify(JSON.parse(body));
	} catch {
		// Not JSON: stored as it was given, compressed.
	}
	return compressBody(compact);
}

/** A refusal of the value itself — its size, past the tier's limit. */
function refusedValue(error: unknown): boolean {
	return (error as { name?: string })?.name === 'ValidationException';
}

export interface SSMStateStoreOptions {
	workspaceName: string;
	region?: AwsRegion;
	/** Uses the default credential chain when omitted. */
	profile?: string;
	credentials?: SSMClientConfig['credentials'];
	/** For the local AWS emulator. */
	endpoint?: string;
}

export class SSMStateStore extends DocumentStateStore {
	constructor(
		readonly workspaceName: string,
		private readonly client: SSMClient,
		/** For messages; the client's own region is used for every call. */
		readonly region = '<region>',
	) {
		super();
	}

	static create(options: SSMStateStoreOptions): SSMStateStore {
		const config: SSMClientConfig = {
			region: options.region,
			endpoint: options.endpoint,
		};
		if (options.profile) {
			// Required lazily: only a profile needs the credential providers.
			const { fromIni } = require('@aws-sdk/credential-providers');
			config.credentials = fromIni({ profile: options.profile });
		} else if (options.credentials) {
			config.credentials = options.credentials;
		}
		return new SSMStateStore(
			options.workspaceName,
			new SSMClient(config),
			options.region,
		);
	}

	private name(stage: string, leaf: string): string {
		return `/gkm/${this.workspaceName}/${stage}/${leaf}`;
	}

	protected location(stage: string): string {
		return `ssm:${this.name(stage, 'state')}`;
	}

	protected async readRaw(stage: string): Promise<RawState | null> {
		const parameter = await this.get(this.name(stage, 'state'));
		if (!parameter) return null;
		return {
			body: decompressBody(parameter.value),
			version: String(parameter.version),
		};
	}

	/** The stage's document as the next write would store it. */
	async capacity(stage: string): Promise<StateCapacity | null> {
		const raw = await this.readRaw(stage);
		if (!raw) return null;
		return {
			bytes: Buffer.byteLength(packSsmBody(raw.body)),
			limit: SSM_MAX_BYTES,
			location: this.location(stage),
			region: this.region,
		};
	}

	protected async writeRaw(
		stage: string,
		document: string,
		expectedVersion: StateVersion | null,
	): Promise<StateVersion> {
		try {
			return await this.put(stage, packSsmBody(document), expectedVersion);
		} catch (error) {
			if (!refusedValue(error)) throw error;
			throw new StateRejectedBySsm(
				stage,
				Buffer.byteLength(packSsmBody(document)),
				this.location(stage),
				this.region,
				error,
			);
		}
	}

	/** The conditional put of `body`, stored as it is given. */
	private async put(
		stage: string,
		body: string,
		expectedVersion: StateVersion | null,
	): Promise<StateVersion> {
		const Name = this.name(stage, 'state');
		const Description = `GKM deployment state for ${this.workspaceName}/${stage}`;

		if (expectedVersion === null) {
			try {
				const { Version } = await this.client.send(
					new PutParameterCommand({
						Name,
						Value: body,
						Type: 'SecureString',
						Tier: 'Intelligent-Tiering',
						Description,
					}),
				);
				return String(Version);
			} catch (error) {
				if (error instanceof ParameterAlreadyExists) {
					const current = await this.get(Name);
					throw new StateVersionConflict(
						stage,
						null,
						current ? String(current.version) : null,
					);
				}
				throw error;
			}
		}

		const current = await this.get(Name);
		const actual = current ? String(current.version) : null;
		if (actual !== expectedVersion) {
			throw new StateVersionConflict(stage, expectedVersion, actual);
		}

		const { Version } = await this.client.send(
			new PutParameterCommand({
				Name,
				Value: body,
				Type: 'SecureString',
				Tier: 'Intelligent-Tiering',
				Overwrite: true,
				Description,
			}),
		);
		if (Version !== Number(expectedVersion) + 1) {
			// Another put landed between the check and this one. Ours is now
			// on top, but the caller that wrote the other believes its write
			// is current — its next write will conflict too, so neither is
			// lost silently.
			throw new StateVersionConflict(
				stage,
				expectedVersion,
				String((Version ?? 1) - 1),
			);
		}

		// The version alone is not enough under an emulator, and need not be
		// on SSM either: two overwrites that raced can both be answered with
		// the same version, and both would report success. If the parameter is
		// still at the version this put returned, it has to hold this body —
		// otherwise the other put is the one that stuck.
		const landed = await this.get(Name);
		if (landed && landed.version === Version && landed.value !== body) {
			throw new StateVersionConflict(stage, expectedVersion, String(Version));
		}
		return String(Version);
	}

	protected async writeV1Backup(stage: string, body: string): Promise<void> {
		try {
			await this.client.send(
				new PutParameterCommand({
					Name: this.name(stage, 'state.v1'),
					// Kept as it was — the v1 state a person restores by hand —
					// unless it is too big to store that way.
					Value: packSsmBody(body),
					Type: 'SecureString',
					Tier: 'Intelligent-Tiering',
					Description: `GKM v1 deployment state for ${this.workspaceName}/${stage}, kept on migration`,
				}),
			);
		} catch (error) {
			// The first migration's backup is the one worth keeping.
			if (!(error instanceof ParameterAlreadyExists)) throw error;
		}
	}

	protected async createLock(stage: string, holder: LockHolder): Promise<void> {
		const Name = this.name(stage, 'lock');
		try {
			await this.client.send(
				new PutParameterCommand({
					Name,
					Value: JSON.stringify(holder),
					// A few hundred bytes: the standard tier, which costs nothing.
					Type: 'String',
					Description: `GKM deploy lock for ${this.workspaceName}/${stage}`,
				}),
			);
		} catch (error) {
			if (error instanceof ParameterAlreadyExists) {
				throw new StateLocked(stage, await this.readLock(stage), `ssm:${Name}`);
			}
			throw error;
		}

		// A create-only put is atomic on SSM, so the lock is ours. Read it back
		// anyway: on a store where two racing creates can both succeed (the
		// local emulator does, a few times in a hundred) the later one has
		// overwritten the earlier — version 2, someone else's holder — and
		// taking the lock regardless would give the stage two deploys.
		const created = await this.get(Name);
		const recorded = created ? parseHolder(created.value) : null;
		if (created?.version !== 1 || recorded?.id !== holder.id) {
			throw new StateLocked(stage, recorded, `ssm:${Name}`);
		}
	}

	protected async readLock(stage: string): Promise<LockHolder | null> {
		const parameter = await this.get(this.name(stage, 'lock'));
		return parameter ? parseHolder(parameter.value) : null;
	}

	protected async removeLock(
		stage: string,
		holder: LockHolder | null,
	): Promise<void> {
		if (holder) {
			const current = await this.readLock(stage);
			if (current?.id !== holder.id) return;
		}
		try {
			await this.client.send(
				new DeleteParameterCommand({ Name: this.name(stage, 'lock') }),
			);
		} catch (error) {
			if (!(error instanceof ParameterNotFound)) throw error;
		}
	}

	private async get(
		Name: string,
	): Promise<{ value: string; version: number } | null> {
		try {
			const { Parameter } = await this.client.send(
				new GetParameterCommand({ Name, WithDecryption: true }),
			);
			if (Parameter?.Value === undefined) return null;
			return { value: Parameter.Value, version: Parameter.Version ?? 1 };
		} catch (error) {
			if (error instanceof ParameterNotFound) return null;
			throw error;
		}
	}
}

function parseHolder(value: string): LockHolder | null {
	try {
		return JSON.parse(value) as LockHolder;
	} catch {
		return null;
	}
}
