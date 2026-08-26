import { SQSClient, type SQSClientConfig } from '@aws-sdk/client-sqs';
import type { EventConnection } from '../types';
import { EventPublisherType } from '../types';
import * as sqsUrl from './sqsUrl';

export interface SQSConnectionConfig {
	queueUrl: string;
	region?: string;
	endpoint?: string; // Custom endpoint (e.g., for LocalStack)
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken?: string;
	};
}

export class SQSConnection implements EventConnection {
	readonly type = EventPublisherType.SQS;
	private client: SQSClient;
	private connected = false;

	constructor(readonly config: SQSConnectionConfig) {
		this.config = config;

		const clientConfig: SQSClientConfig = {
			region: config.region,
			endpoint: config.endpoint,
			credentials: config.credentials,
		};

		this.client = new SQSClient(clientConfig);
	}

	/**
	 * Create an SQSConnection from a connection string
	 * Format: sqs://?queueUrl=https://sqs.region.amazonaws.com/accountId/queueName&region=us-east-1&endpoint=http://localhost:4566
	 */
	static async fromConnectionString(
		connectionString: string,
	): Promise<SQSConnection> {
		// Through the codec, not a second hand-rolled parse: the deploy target
		// composes these with `sqsUrl.build`, and a string it cannot read back is
		// exactly the drift one shared module rules out.
		const { queueUrl, region, endpoint } = sqsUrl.parse(connectionString);
		const params = new URL(connectionString).searchParams;

		const config: SQSConnectionConfig = {
			queueUrl,
			region,
			endpoint,
		};

		// Credentials are not part of the address — see `sqsUrl` — but a caller
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

		const connection = new SQSConnection(config);
		await connection.connect();
		return connection;
	}

	async connect(): Promise<void> {
		// SQS doesn't have a traditional connection, but we mark as connected
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
	 * Get the underlying SQS client
	 */
	get sqsClient(): SQSClient {
		return this.client;
	}

	/**
	 * Get the queue URL for this connection
	 */
	get queueUrl(): string {
		return this.config.queueUrl;
	}
}
