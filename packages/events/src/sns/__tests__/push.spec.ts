import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CreateTopicCommand } from '@aws-sdk/client-sns';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	confirmSnsSubscription,
	SnsCertificateUntrusted,
	type SnsHttpMessage,
	SnsSignatureInvalid,
	snsStringToSign,
	subscribeHttpEndpoint,
	toSnsEvent,
	verifySnsMessage,
} from '../push';
import { SNSConnection } from '../SNSConnection';
import { SNSPublisher } from '../SNSPublisher';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
});
const certificate = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const fetchCertificate = async () => certificate;

function signed(
	message: Omit<SnsHttpMessage, 'Signature' | 'SignatureVersion'>,
	version: '1' | '2' = '2',
): SnsHttpMessage {
	const unsigned = { ...message, SignatureVersion: version, Signature: '' };
	const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
	signer.update(snsStringToSign(unsigned));
	return { ...unsigned, Signature: signer.sign(privateKey, 'base64') };
}

const notification = () =>
	signed({
		Type: 'Notification',
		MessageId: 'm-1',
		TopicArn: 'arn:aws:sns:us-east-1:123456789012:users',
		Message: JSON.stringify({ type: 'user.created', payload: { id: '1' } }),
		Timestamp: '2026-10-03T00:00:00.000Z',
		SigningCertURL:
			'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem',
		MessageAttributes: { type: { Type: 'String', Value: 'user.created' } },
	});

describe('verifySnsMessage', () => {
	it('accepts a message signed by the certificate SNS serves', async () => {
		await expect(
			verifySnsMessage(notification(), { fetchCertificate }),
		).resolves.toBeUndefined();
	});

	it('accepts signature version 1 (SHA1) as well as 2', async () => {
		const message = signed({ ...notification() }, '1');
		await expect(
			verifySnsMessage(message, { fetchCertificate }),
		).resolves.toBeUndefined();
	});

	it('rejects a message altered after it was signed', async () => {
		const message = {
			...notification(),
			Message: JSON.stringify({ type: 'user.created', payload: { id: '2' } }),
		};

		await expect(
			verifySnsMessage(message, { fetchCertificate }),
		).rejects.toBeInstanceOf(SnsSignatureInvalid);
	});

	it('never fetches a certificate from anywhere but SNS', async () => {
		// Otherwise a forger signs with its own key and points at its own cert.
		let fetched = false;
		const message = {
			...notification(),
			SigningCertURL: 'https://attacker.example.com/cert.pem',
		};

		await expect(
			verifySnsMessage(message, {
				fetchCertificate: async () => {
					fetched = true;
					return certificate;
				},
			}),
		).rejects.toBeInstanceOf(SnsCertificateUntrusted);
		expect(fetched).toBe(false);
	});

	it('rejects a lookalike host and plain http', async () => {
		for (const SigningCertURL of [
			'https://sns.us-east-1.amazonaws.com.attacker.io/cert.pem',
			'http://sns.us-east-1.amazonaws.com/cert.pem',
			// What the emulator sends: not a URL at all.
			'EXAMPLE',
		]) {
			await expect(
				verifySnsMessage(
					{ ...notification(), SigningCertURL },
					{ fetchCertificate },
				),
			).rejects.toBeInstanceOf(SnsCertificateUntrusted);
		}
	});
});

describe('toSnsEvent', () => {
	it('is the Lambda event SNS would have invoked a function with', () => {
		const message = notification();
		const event = toSnsEvent(message, 'arn:sub');

		expect(event.Records).toHaveLength(1);
		expect(event.Records[0]).toMatchObject({
			EventSource: 'aws:sns',
			EventSubscriptionArn: 'arn:sub',
			Sns: {
				Message: message.Message,
				TopicArn: message.TopicArn,
				SigningCertUrl: message.SigningCertURL,
				MessageAttributes: { type: { Type: 'String', Value: 'user.created' } },
			},
		});
	});
});

/**
 * Against the AWS emulator (floci on 4566), which pushes to the host through
 * `host.docker.internal` — the same arrangement `gkm dev` uses.
 */
describe('HTTP push through the emulator', () => {
	const received: { path: string; message: SnsHttpMessage }[] = [];
	let server: Server;
	let port: number;
	let connection: SNSConnection;

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk;
			});
			req.on('end', () => {
				received.push({ path: req.url ?? '', message: JSON.parse(body) });
				res.end();
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '0.0.0.0', () => resolve()),
		);
		port = (server.address() as AddressInfo).port;

		const probe = new SNSConnection({
			topicArn: '',
			region: 'us-east-1',
			endpoint: 'http://localhost:4566',
			credentials: { accessKeyId: 'LSIAtest', secretAccessKey: 'test' },
		});
		const { TopicArn } = await probe.snsClient.send(
			new CreateTopicCommand({ Name: `push-${crypto.randomUUID()}` }),
		);
		connection = new SNSConnection({
			topicArn: TopicArn as string,
			region: 'us-east-1',
			endpoint: 'http://localhost:4566',
			credentials: { accessKeyId: 'LSIAtest', secretAccessKey: 'test' },
		});
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
		connection?.close();
	});

	const until = async (check: () => boolean) => {
		for (let i = 0; i < 50 && !check(); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};

	it('fans out to each subscriber, filtered to the events it named', async () => {
		const base = `http://host.docker.internal:${port}`;
		await subscribeHttpEndpoint(connection, {
			endpoint: `${base}/created`,
			events: ['user.created'],
		});
		await subscribeHttpEndpoint(connection, {
			endpoint: `${base}/both`,
			events: ['user.created', 'user.updated'],
		});

		await until(
			() =>
				received.filter((r) => r.message.Type === 'SubscriptionConfirmation')
					.length === 2,
		);
		for (const { message } of received) {
			await confirmSnsSubscription(message);
		}
		received.length = 0;

		await new SNSPublisher(connection).publish([
			{ type: 'user.updated', payload: { id: '1' } },
			{ type: 'user.created', payload: { id: '2' } },
		]);
		await until(() => received.length === 3);

		const byPath = (path: string) =>
			received
				.filter((r) => r.path === path)
				.map((r) => JSON.parse(r.message.Message).type)
				.sort();
		expect(byPath('/created')).toEqual(['user.created']);
		expect(byPath('/both')).toEqual(['user.created', 'user.updated']);
	});

	it('resubscribes an endpoint whose confirmation never landed', async () => {
		// The endpoint was down when SNS confirmed — the next start must not be
		// left with a subscription that delivers nothing.
		const endpoint = `http://host.docker.internal:${port}/stuck`;
		const confirmations = () =>
			received.filter(
				(r) =>
					r.path === '/stuck' && r.message.Type === 'SubscriptionConfirmation',
			);

		await subscribeHttpEndpoint(connection, {
			endpoint,
			events: ['user.created'],
		});
		await until(() => confirmations().length === 1);
		// Not confirmed. Started again:
		await subscribeHttpEndpoint(connection, {
			endpoint,
			events: ['user.created'],
		});
		await until(() => confirmations().length === 2);

		expect(confirmations()).toHaveLength(2);
		await confirmSnsSubscription(confirmations()[1]!.message);
		await new SNSPublisher(connection).publish([
			{ type: 'user.created', payload: { id: '3' } },
		]);
		await until(() =>
			received.some(
				(r) => r.path === '/stuck' && r.message.Type === 'Notification',
			),
		);
		expect(
			received.filter(
				(r) => r.path === '/stuck' && r.message.Type === 'Notification',
			),
		).toHaveLength(1);
	});

	it('brings a confirmed subscription’s filter up to the events now named', async () => {
		const endpoint = `http://host.docker.internal:${port}/grows`;
		await subscribeHttpEndpoint(connection, {
			endpoint,
			events: ['user.created'],
		});
		await until(() => received.some((r) => r.path === '/grows'));
		await confirmSnsSubscription(
			received.find((r) => r.path === '/grows')!.message,
		);

		// The subscriber now names a second event.
		await subscribeHttpEndpoint(connection, {
			endpoint,
			events: ['user.created', 'user.deleted'],
		});
		await new SNSPublisher(connection).publish([
			{ type: 'user.deleted', payload: { id: '4' } },
		]);
		await until(() =>
			received.some(
				(r) => r.path === '/grows' && r.message.Type === 'Notification',
			),
		);

		const delivered = received.filter(
			(r) => r.path === '/grows' && r.message.Type === 'Notification',
		);
		expect(delivered.map((r) => JSON.parse(r.message.Message).type)).toEqual([
			'user.deleted',
		]);
	});
});
