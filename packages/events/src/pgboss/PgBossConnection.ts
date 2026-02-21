import PgBoss from 'pg-boss';
import type { EventConnection } from '../types';
import { EventPublisherType } from '../types';

export interface PgBossConnectionConfig {
	connectionString: string;
	schema?: string;
}

export class PgBossConnection implements EventConnection {
	readonly type = EventPublisherType.PgBoss;
	private boss?: PgBoss;
	private connecting?: Promise<void>;

	constructor(private config: PgBossConnectionConfig) {}

	/**
	 * Create a PgBossConnection from a connection string.
	 * Format: pgboss://user:pass@host:5432/database?schema=pgboss
	 */
	static async fromConnectionString(
		connectionString: string,
	): Promise<PgBossConnection> {
		const url = new URL(connectionString);
		const params = url.searchParams;

		const postgresUrl = `postgres://${url.username ? `${url.username}:${url.password}@` : ''}${url.host}${url.pathname}`;

		const config: PgBossConnectionConfig = {
			connectionString: postgresUrl,
			schema: params.get('schema') || undefined,
		};

		const connection = new PgBossConnection(config);
		await connection.connect();
		return connection;
	}

	async connect(): Promise<void> {
		if (this.boss) return;

		if (this.connecting) {
			await this.connecting;
			return;
		}

		this.connecting = (async () => {
			try {
				const boss = new PgBoss({
					connectionString: this.config.connectionString,
					...(this.config.schema && { schema: this.config.schema }),
				});

				await boss.start();
				this.boss = boss;
			} catch (error) {
				this.cleanup();
				throw error;
			}
		})();

		await this.connecting;
		this.connecting = undefined;
	}

	async close(): Promise<void> {
		try {
			await this.boss?.stop({ graceful: true });
		} catch {
			// Ignore errors during close
		} finally {
			this.cleanup();
		}
	}

	isConnected(): boolean {
		return !!this.boss;
	}

	private cleanup(): void {
		this.boss = undefined;
		this.connecting = undefined;
	}

	/**
	 * Get the underlying pg-boss instance for publishing/subscribing
	 */
	get instance(): PgBoss | undefined {
		return this.boss;
	}
}
