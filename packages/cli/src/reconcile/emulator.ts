/**
 * The AWS emulator (floci, LocalStack-compatible) the `sns` backend runs on
 * locally — the facts the compose file, the env writer and the applier must
 * agree on.
 *
 * The emulator has one account and answers with deterministic ARNs and queue
 * URLs, which is what lets a connection string be composed before the topic
 * or queue it names has been created.
 */

/** The emulator's single account. */
export const EMULATOR_ACCOUNT = '000000000000';

export const EMULATOR_REGION = 'us-east-1';

/**
 * The emulator's credential. The `LSIA` prefix is what LocalStack required on
 * issued keys; floci does not care, and keeping it means a project that pins
 * the old image still works.
 */
export const EMULATOR_CREDENTIALS = {
	accessKeyId: 'LSIAQAAAAAAVNCBMPNSG',
	secretAccessKey: 'geekmidas',
} as const;

/** The emulator's address from the host, on the port it was published on. */
export function emulatorEndpoint(port: number): string {
	return `http://localhost:${port}`;
}

export function emulatorTopicArn(name: string): string {
	return `arn:aws:sns:${EMULATOR_REGION}:${EMULATOR_ACCOUNT}:${name}`;
}

export function emulatorQueueUrl(name: string, port: number): string {
	return `${emulatorEndpoint(port)}/${EMULATOR_ACCOUNT}/${name}`;
}
