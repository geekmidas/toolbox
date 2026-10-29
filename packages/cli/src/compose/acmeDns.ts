/**
 * The key the server's shared Traefik edge answers Let's Encrypt's DNS
 * challenge with, for a stage with a wildcard site.
 *
 * A wildcard certificate is issued only over the DNS challenge: the edge
 * proves it holds `<domain>` by writing a TXT record at
 * `_acme-challenge.<domain>`. So it needs a key that can write that record —
 * and nothing else, because it lives on the server.
 *
 * - **The user**: one per server, under `/gkm/`, tagged with the server it
 *   is for. One that exists without that tag is someone else's, and is
 *   refused rather than taken over.
 * - **Its policies**: one per stack on the server, named for its compose
 *   project, allowing `ChangeResourceRecordSets` on the stage's hosted zone
 *   for TXT records named `_acme-challenge.<domain>` alone — plus what
 *   finding the zone and waiting for the change take, which read and write
 *   nothing. Put back on every deploy.
 * - **Its key**: written into the edge's container, never into the stage's
 *   secrets or onto the machine running the deploy. Issued when the edge
 *   has none, or holds one IAM no longer knows — and then the edge is
 *   restarted, since it keeps the key it first read.
 */

import { createHash } from 'node:crypto';
import type { IAMClient } from '@aws-sdk/client-iam';
import type { Route53Client } from '@aws-sdk/client-route-53';
import { GkmError } from '../errors';
import type { ComposeDocker, StackRef } from './docker.js';
import { readEdgeFile, restartEdge, writeEdgeSecret } from './edge.js';
import { EDGE_AWS_CREDENTIALS, EDGE_PROJECT } from './traefik.js';

/** Where gkm's IAM users live. */
const USER_PATH = '/gkm/';

/** The tag a server's edge user is found by. */
export const TAG_EDGE = 'gkm:edge';

/** What the key is issued and its zone found through. */
export interface AcmeDnsClients {
	iam: IAMClient;
	route53: Route53Client;
}

/** The edge user's name for a server: stable, and safe for IAM. */
export function edgeAcmeUser(server: string): string {
	const hash = createHash('sha256').update(server).digest('hex').slice(0, 12);
	return `gkm-edge-acme-${hash}`;
}

/**
 * What one stage's wildcard certificate needs: its challenge record written
 * in its zone, the change waited on, and the zone found by name — which is
 * how the edge's ACME client finds it.
 */
export function acmeDnsPolicy(zoneId: string, domain: string): string {
	return JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Action: 'route53:ChangeResourceRecordSets',
				Resource: `arn:aws:route53:::hostedzone/${zoneId}`,
				Condition: {
					'ForAllValues:StringEquals': {
						'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
							`_acme-challenge.${domain.toLowerCase()}`,
						],
						'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
					},
				},
			},
			{
				Effect: 'Allow',
				Action: 'route53:ListResourceRecordSets',
				Resource: `arn:aws:route53:::hostedzone/${zoneId}`,
			},
			{
				Effect: 'Allow',
				Action: 'route53:GetChange',
				Resource: 'arn:aws:route53:::change/*',
			},
			{
				Effect: 'Allow',
				Action: 'route53:ListHostedZonesByName',
				Resource: '*',
			},
		],
	});
}

/** An IAM user by the edge user's name that gkm did not create for this server. */
export class EdgeAcmeUserNotOwned extends GkmError {
	constructor(
		readonly user: string,
		readonly server: string,
	) {
		super(
			`The IAM user ${user} exists but is not tagged ${TAG_EDGE}=${server}, ` +
				`so gkm will not take it over to write the shared edge's DNS ` +
				`challenge records. Delete it, or tag it ${TAG_EDGE}=${server} if it ` +
				`is the one gkm created for this server.`,
		);
		this.name = 'EdgeAcmeUserNotOwned';
	}
}

/** A wildcard site's domain with no Route 53 hosted zone to answer it in. */
export class AcmeHostedZoneMissing extends GkmError {
	constructor(readonly domain: string) {
		super(
			`No Route 53 hosted zone holds ${domain}, so the shared edge cannot ` +
				`answer the DNS challenge for its wildcard certificate. Create the ` +
				`zone, or set hostedZoneId in its dns entry.`,
		);
		this.name = 'AcmeHostedZoneMissing';
	}
}

export interface EnsureEdgeAcmeKeyOptions {
	clients: AcmeDnsClients;
	/** The edge's compose project, as docker is asked about it. */
	edge: StackRef;
	/** What identifies the server: its public IPv4 address, or its SSH host. */
	server: string;
	/** The stack's compose project: what its policy is named. */
	project: string;
	/** The stage's domain, under which its tenants' hosts sit. */
	domain: string;
	/** The root domain in `dns` — the zone's name. */
	zone: string;
	/** The zone's id, where its `dns` entry names one. */
	hostedZoneId?: string;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface EdgeAcmeKey {
	user: string;
	zoneId: string;
	/** Whether a key was issued and written to the edge on this run. */
	issued: boolean;
}

/**
 * The edge's key for `domain`'s challenge record: its user, this stack's
 * policy on it, and a key in the edge that IAM knows.
 *
 * @throws {EdgeAcmeUserNotOwned} when the user is someone else's
 * @throws {AcmeHostedZoneMissing} when no hosted zone holds the domain
 */
export async function ensureEdgeAcmeKey(
	docker: ComposeDocker,
	options: EnsureEdgeAcmeKeyOptions,
): Promise<EdgeAcmeKey> {
	const { clients, edge, server, project, domain } = options;
	const log = options.log ?? ((line: string) => console.log(line));
	const IAM = await import('@aws-sdk/client-iam');
	const user = edgeAcmeUser(server);
	const zoneId =
		options.hostedZoneId ?? (await hostedZoneId(clients.route53, options.zone));
	if (!zoneId) throw new AcmeHostedZoneMissing(domain);

	if (options.dryRun) {
		log(
			`🔑 Would let ${EDGE_PROJECT} write _acme-challenge.${domain} TXT records in ${zoneId}, as IAM user ${user} (dry run — nothing is written)`,
		);
		return { user, zoneId, issued: false };
	}

	const existing = await clients.iam
		.send(new IAM.GetUserCommand({ UserName: user }))
		.catch((error: { name?: string }) => {
			if (
				error?.name === 'NoSuchEntity' ||
				error?.name === 'NoSuchEntityException'
			) {
				return undefined;
			}
			throw error;
		});
	if (!existing?.User) {
		await clients.iam.send(
			new IAM.CreateUserCommand({
				UserName: user,
				Path: USER_PATH,
				Tags: [{ Key: TAG_EDGE, Value: server }],
			}),
		);
	} else {
		const { Tags = [] } = await clients.iam.send(
			new IAM.ListUserTagsCommand({ UserName: user }),
		);
		const owned = Tags.some((t) => t.Key === TAG_EDGE && t.Value === server);
		if (!owned) throw new EdgeAcmeUserNotOwned(user, server);
	}

	await clients.iam.send(
		new IAM.PutUserPolicyCommand({
			UserName: user,
			PolicyName: project,
			PolicyDocument: acmeDnsPolicy(zoneId, domain),
		}),
	);
	log(
		`🔑 ${EDGE_PROJECT} may write _acme-challenge.${domain} TXT records in ${zoneId}, and nothing else there, as IAM user ${user}`,
	);

	const written = await readEdgeFile(docker, edge, EDGE_AWS_CREDENTIALS);
	const held = written?.match(/aws_access_key_id\s*=\s*(\S+)/)?.[1];
	const { AccessKeyMetadata = [] } = await clients.iam.send(
		new IAM.ListAccessKeysCommand({ UserName: user }),
	);
	if (held && AccessKeyMetadata.some((k) => k.AccessKeyId === held)) {
		return { user, zoneId, issued: false };
	}

	// The edge holds none, or one IAM no longer has: every key of the user is
	// retired — it is the edge's alone — and one issued in its place.
	for (const key of AccessKeyMetadata) {
		if (!key.AccessKeyId) continue;
		await clients.iam.send(
			new IAM.DeleteAccessKeyCommand({
				UserName: user,
				AccessKeyId: key.AccessKeyId,
			}),
		);
	}
	const { AccessKey } = await clients.iam.send(
		new IAM.CreateAccessKeyCommand({ UserName: user }),
	);
	await writeEdgeSecret(
		docker,
		edge,
		EDGE_AWS_CREDENTIALS,
		`# Written by gkm compose — the key ${EDGE_PROJECT} answers DNS challenges with.
[default]
aws_access_key_id = ${AccessKey?.AccessKeyId}
aws_secret_access_key = ${AccessKey?.SecretAccessKey}
`,
	);
	log(
		`🔑 Wrote a new key for ${user} to ${EDGE_PROJECT} (${EDGE_AWS_CREDENTIALS})`,
	);
	// It replaced one the edge may already have read and kept.
	if (written !== undefined) await restartEdge(docker, edge);
	return { user, zoneId, issued: true };
}

/** The id of the hosted zone named exactly `zone`, if there is one. */
async function hostedZoneId(
	route53: Route53Client,
	zone: string,
): Promise<string | undefined> {
	const { ListHostedZonesByNameCommand } = await import(
		'@aws-sdk/client-route-53'
	);
	const name = zone.endsWith('.') ? zone : `${zone}.`;
	const { HostedZones = [] } = await route53.send(
		new ListHostedZonesByNameCommand({ DNSName: name, MaxItems: 1 }),
	);
	const found = HostedZones.find((z) => z.Name === name);
	return found?.Id?.replace('/hostedzone/', '');
}
