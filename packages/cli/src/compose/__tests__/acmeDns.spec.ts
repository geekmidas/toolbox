import {
	CreateUserCommand,
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	GetUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
	ListUserPoliciesCommand,
} from '@aws-sdk/client-iam';
import {
	CreateHostedZoneCommand,
	DeleteHostedZoneCommand,
	Route53Client,
} from '@aws-sdk/client-route-53';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import {
	AcmeHostedZoneMissing,
	acmeDnsPolicy,
	EdgeAcmeUserNotOwned,
	edgeAcmeUser,
	ensureEdgeAcmeKey,
} from '../acmeDns';
import type { StackRef } from '../docker';
import { EDGE_AWS_CREDENTIALS } from '../traefik';
import { fakeDocker } from './__helpers__/fakeDocker';

/**
 * The shared edge's DNS-challenge key, issued through IAM and its zone found
 * in Route 53 — both on the AWS emulator — and written into an edge whose
 * files are kept in memory.
 */

const AWS = {
	region: 'us-east-1',
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const ZONE = `acme-dns-${Date.now()}.test`;
const DOMAIN = `shop.${ZONE}`;
const EDGE: StackRef = {
	project: 'gkm-edge',
	file: '/tmp/edge.yml',
	cwd: '/tmp',
};

/** An edge whose files are a map, and whose restarts are counted. */
function edge(files = new Map<string, string>()) {
	let restarts = 0;
	const { docker } = fakeDocker({
		exec: (_stack, _service, command, input) => {
			if (command[0] === 'cat') {
				const content = files.get(command[1]!);
				return content === undefined
					? { code: 1, stdout: '', stderr: 'No such file' }
					: { code: 0, stdout: content, stderr: '' };
			}
			if (command[0] === 'kill') {
				restarts++;
				return { code: 0, stdout: '', stderr: '' };
			}
			if (command[0] === 'sh' && command[2]?.includes('cat >')) {
				files.set(command[4]!, input ?? '');
			}
			return { code: 0, stdout: '', stderr: '' };
		},
	});
	return { docker, files, restarts: () => restarts };
}

describe("the shared edge's DNS-challenge key", () => {
	const iam = new IAMClient(AWS);
	const route53 = new Route53Client(AWS);
	const clients = { iam, route53 };
	let zoneId: string;
	const servers: string[] = [];

	const ensure = (
		docker: ReturnType<typeof edge>['docker'],
		server: string,
		project = 'shop-production',
	) => {
		servers.push(server);
		return ensureEdgeAcmeKey(docker, {
			clients,
			edge: EDGE,
			server,
			project,
			domain: DOMAIN,
			zone: ZONE,
			log: () => {},
		});
	};

	beforeAll(async () => {
		const created = await route53.send(
			new CreateHostedZoneCommand({
				Name: ZONE,
				CallerReference: `acme-dns-${Date.now()}`,
			}),
		);
		zoneId = created.HostedZone!.Id!.replace('/hostedzone/', '');
	});

	afterEach(async () => {
		for (const server of servers.splice(0)) {
			const UserName = edgeAcmeUser(server);
			const keys = await iam
				.send(new ListAccessKeysCommand({ UserName }))
				.catch(() => undefined);
			if (!keys) continue;
			for (const key of keys.AccessKeyMetadata ?? []) {
				await iam.send(
					new DeleteAccessKeyCommand({
						UserName,
						AccessKeyId: key.AccessKeyId,
					}),
				);
			}
			const { PolicyNames = [] } = await iam.send(
				new ListUserPoliciesCommand({ UserName }),
			);
			for (const PolicyName of PolicyNames) {
				await iam.send(new DeleteUserPolicyCommand({ UserName, PolicyName }));
			}
			await iam.send(new DeleteUserCommand({ UserName }));
		}
	});

	afterAll(async () => {
		await route53.send(new DeleteHostedZoneCommand({ Id: zoneId }));
		iam.destroy();
		route53.destroy();
	});

	it("writes a key into the edge, allowed only the stage's challenge record", async () => {
		const server = `203.0.113.${Math.floor(Math.random() * 200)}`;
		const { docker, files } = edge();

		const key = await ensure(docker, server);

		expect(key).toMatchObject({ zoneId, issued: true });
		const written = files.get(EDGE_AWS_CREDENTIALS)!;
		const { AccessKeyMetadata = [] } = await iam.send(
			new ListAccessKeysCommand({ UserName: key.user }),
		);
		expect(AccessKeyMetadata).toHaveLength(1);
		expect(written).toContain(
			`aws_access_key_id = ${AccessKeyMetadata[0]!.AccessKeyId}`,
		);

		const { PolicyDocument } = await iam.send(
			new GetUserPolicyCommand({
				UserName: key.user,
				PolicyName: 'shop-production',
			}),
		);
		const policy = JSON.parse(decodeURIComponent(PolicyDocument!));
		expect(policy).toEqual(JSON.parse(acmeDnsPolicy(zoneId, DOMAIN)));
		expect(policy.Statement[0].Condition).toEqual({
			'ForAllValues:StringEquals': {
				'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
					`_acme-challenge.${DOMAIN}`,
				],
				'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
			},
		});
	});

	it('keeps the key the edge holds, and adds each stage its own policy', async () => {
		const server = `198.51.100.${Math.floor(Math.random() * 200)}`;
		const { docker, files, restarts } = edge();
		await ensure(docker, server, 'shop-production');
		const first = files.get(EDGE_AWS_CREDENTIALS);

		const again = await ensure(docker, server, 'shop-staging');

		expect(again.issued).toBe(false);
		expect(files.get(EDGE_AWS_CREDENTIALS)).toBe(first);
		expect(restarts()).toBe(0);
		const { PolicyNames = [] } = await iam.send(
			new ListUserPoliciesCommand({ UserName: again.user }),
		);
		expect(PolicyNames.sort()).toEqual(['shop-production', 'shop-staging']);
	});

	it('replaces a key IAM no longer has, and restarts the edge to read it', async () => {
		const server = `192.0.2.${Math.floor(Math.random() * 200)}`;
		const files = new Map([
			[
				EDGE_AWS_CREDENTIALS,
				'[default]\naws_access_key_id = AKIAGONE\naws_secret_access_key = x\n',
			],
		]);
		const { docker, restarts } = edge(files);

		const key = await ensure(docker, server);

		expect(key.issued).toBe(true);
		expect(files.get(EDGE_AWS_CREDENTIALS)).not.toContain('AKIAGONE');
		expect(restarts()).toBe(1);
	});

	it('refuses a user by its name that is not tagged for the server', async () => {
		const server = `192.0.2.${200 + Math.floor(Math.random() * 50)}`;
		servers.push(server);
		await iam.send(new CreateUserCommand({ UserName: edgeAcmeUser(server) }));

		await expect(ensure(edge().docker, server)).rejects.toThrow(
			EdgeAcmeUserNotOwned,
		);
	});

	it('refuses a domain no hosted zone holds', async () => {
		await expect(
			ensureEdgeAcmeKey(edge().docker, {
				clients,
				edge: EDGE,
				server: '192.0.2.1',
				project: 'shop-production',
				domain: 'shop.nowhere.test',
				zone: 'nowhere.test',
				log: () => {},
			}),
		).rejects.toThrow(AcmeHostedZoneMissing);
	});
});
