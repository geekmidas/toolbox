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
	DocumentStateStore,
	type LockHolder,
	type RawState,
	StateLocked,
	type StateVersion,
	StateVersionConflict,
} from './StateStore';

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
		return new SSMStateStore(options.workspaceName, new SSMClient(config));
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
		return { body: parameter.value, version: String(parameter.version) };
	}

	protected async writeRaw(
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
		return String(Version);
	}

	protected async writeV1Backup(stage: string, body: string): Promise<void> {
		try {
			await this.client.send(
				new PutParameterCommand({
					Name: this.name(stage, 'state.v1'),
					Value: body,
					Type: 'SecureString',
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
	}

	protected async readLock(stage: string): Promise<LockHolder | null> {
		const parameter = await this.get(this.name(stage, 'lock'));
		if (!parameter) return null;
		try {
			return JSON.parse(parameter.value) as LockHolder;
		} catch {
			return null;
		}
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
