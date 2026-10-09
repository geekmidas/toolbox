/**
 * The DNS step of `gkm setup --stage <stage>`: a compose stage's public hosts
 * pointed at its server, through each domain's provider in `dns`.
 *
 * It runs where setup runs — the laptop or the CI job — with that machine's
 * DNS credentials (`GODADDY_API_TOKEN`, `gkm login --provider godaddy`, an AWS
 * profile for Route53). The server never holds them.
 *
 * The address the records point at is the stage's own secret,
 * `GKM_SERVER_IPV4` (and `GKM_SERVER_IPV6`): a compose stage that serves a
 * domain is refused without it, by `assertStageServer` — before setup or a
 * deploy does anything else.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import {
	applyStackDns,
	type DnsChange,
	planStackDns,
	requiredServerAddress,
	type ServerAddress,
	serverAddress,
	serverAddressHint,
	stackHosts,
} from '../compose/dns.js';
import { MissingCredential } from '../deploy/credentials.js';
import { recordDnsChanges } from '../deploy/dnsResources.js';
import { deployIdentity } from '../deploy/identity.js';
import type { DeployJournal } from '../deploy/journal.js';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { StageSecrets } from '../secrets/types.js';
import type { DnsProvider } from '../target/dokploy/dns/DnsProvider.js';
import type {
	DnsProvider as DnsProviderConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';

export interface ProvisionDnsOptions {
	workspace: NormalizedWorkspace;
	stage: string;
	dryRun?: boolean;
	/** The AWS profile, for a stage whose secrets live in AWS. */
	profile?: string;
	/** The CLI's home: where `gkm login` stored DNS credentials. */
	home?: string;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
	manifest?: ConstructManifest;
	runnables?: Record<string, string[]>;
	background?: Record<string, string[]>;
	/** The stage's hosts, when the caller has them. */
	hosts?: readonly string[];
	/** The provider for a domain, for tests. */
	providerFor?: (config: DnsProviderConfig) => Promise<DnsProvider | null>;
	/**
	 * The stage's journal: each record written is kept as a `dns-record`
	 * resource in its state, each one deleted forgotten. A dry run keeps none.
	 */
	journal?: DeployJournal;
}

/** Whether the workspace deploys through the compose target. */
export function deploysWithCompose(workspace: NormalizedWorkspace): boolean {
	return (
		workspace.deploy?.default === 'compose' ||
		Object.values(workspace.apps).some(
			(app) => app.resolvedDeployTarget === 'compose',
		)
	);
}

/**
 * A compose stage that serves a domain has its server's address in its
 * secrets — checked before `gkm setup --stage` does anything else.
 *
 * @throws {ServerAddressMissing} for a compose stage with a domain and none
 * @throws {ServerAddressInvalid} for a value that is not an address
 */
export function assertStageServer(
	workspace: NormalizedWorkspace,
	stage: string,
	secrets: StageSecrets | null | undefined,
): ServerAddress | undefined {
	if (stage === workspace.stages.local) return undefined;
	if (!deploysWithCompose(workspace)) {
		return serverAddress(stage, secrets?.custom);
	}
	return requiredServerAddress(
		stage,
		workspace.domains?.[stage],
		secrets?.custom,
	);
}

export interface DnsReport {
	/** `none`: no server address or no `dns`, so no records. */
	mode: 'none' | 'records';
	hosts: string[];
	changes: DnsChange[];
}

/**
 * The hosts a compose stage serves: its stack composed as a deploy would —
 * with the secrets it would generate made up in memory, never written — and
 * every route's host read off it.
 */
export async function composeStageHosts(options: {
	workspace: NormalizedWorkspace;
	stage: string;
	profile?: string;
	home?: string;
	manifest?: ConstructManifest;
	runnables?: Record<string, string[]>;
	background?: Record<string, string[]>;
}): Promise<string[]> {
	const { workspace, stage } = options;
	const runnables = options.runnables ?? {};
	const background = options.background ?? {};
	const manifest =
		options.manifest ??
		(await discover({
			patterns: constructGlobs(workspace),
			cwd: workspace.root,
			runnables,
			background,
		}));
	const store = await secretsStoreFor(workspace, stage, {
		...(options.profile ? { profile: options.profile } : {}),
		...(options.home ? { home: options.home } : {}),
	});
	const stored = await store.read(stage);
	const { deployedStackSecrets } = await import('../compose/secrets.js');
	const { composeStack } = await import('../compose/stack.js');
	const { secrets } = deployedStackSecrets(workspace, stage, stored, manifest);
	const stack = composeStack({
		workspace,
		manifest,
		runnables,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: {
			mode: 'pull',
			tag: 'dns',
			...(workspace.deploy?.registry
				? { registry: workspace.deploy.registry }
				: {}),
		},
		secrets,
		// Only the routes are read: no backend's environment is resolved, and
		// a construct the stage does not account for yet is not a refusal here
		// — the deploy is where that is said.
		buildOnly: true,
		allowDevServices: true,
	});
	return stackHosts(stack);
}

/**
 * `GKM_SERVER_IPV4` from the stage's secrets and `dns`: each public host's
 * records, created or corrected. A dry run reads and prints, and writes
 * nothing.
 */
export async function provisionStageDns(
	options: ProvisionDnsOptions,
): Promise<DnsReport> {
	const { workspace, stage } = options;
	const log = options.log ?? ((line: string) => console.log(line));
	if (
		stage === workspace.stages.local ||
		!workspace.dns ||
		!deploysWithCompose(workspace)
	) {
		return { mode: 'none', hosts: [], changes: [] };
	}
	const store = await secretsStoreFor(workspace, stage, {
		...(options.profile ? { profile: options.profile } : {}),
		...(options.home ? { home: options.home } : {}),
	});
	const server = serverAddress(stage, (await store.read(stage))?.custom);
	if (!server) {
		log(
			`\n🌐 DNS for '${stage}': no GKM_SERVER_IPV4 in its secrets, so no records — ${serverAddressHint(stage)}`,
		);
		return { mode: 'none', hosts: [], changes: [] };
	}

	const hosts = [
		...(options.hosts ??
			(await composeStageHosts({
				workspace,
				stage,
				...(options.profile ? { profile: options.profile } : {}),
				...(options.home ? { home: options.home } : {}),
				...(options.manifest ? { manifest: options.manifest } : {}),
				...(options.runnables ? { runnables: options.runnables } : {}),
				...(options.background ? { background: options.background } : {}),
			}))),
	];

	log(
		`\n🌐 DNS for '${stage}' → ${server.ipv4}${server.ipv6 ? ` / ${server.ipv6}` : ''}${options.dryRun ? ' (dry run — nothing is written)' : ''}`,
	);
	const plan = planStackDns({
		stage,
		hosts,
		server,
		dns: workspace.dns,
	});
	try {
		const changes = await applyStackDns(plan, {
			...(options.dryRun ? { dryRun: true } : {}),
			log,
			credentials: {
				env: options.env ?? process.env,
				...(options.home ? { home: options.home } : {}),
				log,
			},
			...(options.providerFor ? { providerFor: options.providerFor } : {}),
		});
		if (options.journal && !options.dryRun) {
			const providers = new Map(
				plan.domains.map((domain) => [domain.domain, domain.provider]),
			);
			await recordDnsChanges(options.journal, changes, (domain) =>
				providers.get(domain),
			);
		}
		return { mode: 'records', hosts, changes };
	} catch (error) {
		// No credentials on this machine: the framework's rule — say how to
		// supply them, and leave the records to the person.
		if (error instanceof MissingCredential) {
			log(`   ⚠ ${error.message}`);
			log('   Until then, create these records yourself:');
			for (const domain of plan.domains) {
				for (const r of domain.records) {
					log(
						`     ${r.host.padEnd(32)} ${r.type.padEnd(5)} ${r.value}  (TTL ${r.ttl})`,
					);
				}
			}
			return { mode: 'records', hosts, changes: [] };
		}
		throw error;
	}
}
