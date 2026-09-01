import { SNSClient, type SNSClientConfig } from '@aws-sdk/client-sns';
import type { EventConnection } from '../types';
import { EventPublisherType } from '../types';
import * as snsUrl from './snsUrl';

export interface SNSConnectionConfig {
	topicArn: string;
	region?: string;
	endpoint?: string; // Custom endpoint (e.g., for LocalStack)
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken?: string;
	};
}

export class SNSConnection implements EventConnection {
	readonly type = EventPublisherType.SNS;
	private client: SNSClient;
	private connected = false;
	private config: SNSConnectionConfig;

	constructor(config: SNSConnectionConfig) {
		this.config = config;

		const clientConfig: SNSClientConfig = {
			region: config.region,
			endpoint: config.endpoint,
			credentials: config.credentials,
		};

		this.client = new SNSClient(clientConfig);
	}

	/**
	 * Create an SNSConnection from a connection string
	 * Format: sns://?topicArn=arn:aws:sns:region:account:topic&region=us-east-1&endpoint=http://localhost:4566
	 */
	static async fromConnectionString(
		connectionString: string,
	): Promise<SNSConnection> {
		// Through the codec, not a second hand-rolled parse: the deploy target
		// composes these with `snsUrl.build`, and a string it cannot read back is
		// exactly the drift one shared module rules out.
		const { topicArn, region, endpoint } = snsUrl.parse(connectionString);
		const params = new URL(connectionString).searchParams;

		const config: SNSConnectionConfig = {
			topicArn,
			region,
			endpoint,
		};

		// Credentials are not part of the address — see `snsUrl` — but a caller
		// may still pin them here, so they are read beside it rather than in it.
		const accessKeyId = params.get('accessKeyId');
		const secretAccessKey = params.get('secretAccessKey');
		if (accessKeyId && secretAccessKey) {
			config.credentials = {
				accessKeyId,
				secretAccessKey,
				sessionToken: params.get('sessionToken') || undefined,
			};
		}

		const connection = new SNSConnection(config);
		await connection.connect();
		return connection;
	}

	async connect(): Promise<void> {
		// SNS doesn't have a traditional connection, but we mark as connected
		this.connected = true;
	}

	async close(): Promise<void> {
		this.client.destroy();
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Get the underlying SNS client
	 */
	get snsClient(): SNSClient {
		return this.client;
	}

	/**
	 * Get the topic ARN for this connection
	 */
	get topicArn(): string {
		return this.config.topicArn;
	}
}
