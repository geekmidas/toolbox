/**
 * `gkm compose --stage <stage> --destroy`: everything a deploy made for the
 * stage, deleted for good.
 *
 * The one thing in gkm that deletes what a deploy created — a deploy itself
 * never does. So it is careful in three ways:
 *
 * - **Only what is provably gkm's.** Each AWS resource is checked against
 *   what gkm marks its own with before it is deleted (see
 *   `providers/s3/destroy.ts`); a DNS record only while it still holds the
 *   value gkm wrote. What fails is listed, and left where it is.
 * - **Only with a person typing the stage.** The whole plan is printed
 *   first, then the compose project's name — `<project>-<stage>` — has to be
 *   typed back. Nothing skips that: there is no flag that answers it, and
 *   with no terminal to ask at it refuses before reading anything.
 * - **Resumable.** Each resource's record is forgotten as soon as it is gone,
 *   so a run that stops part way — a distribution still deploying — carries
 *   on from there when it is run again.
 *
 * What other stages or projects share is never touched: the project bucket
 * that holds every stage's state, the shared Traefik edge, the server's own
 * setup (`gkm compose:server`). The stage's secrets are kept unless
 * `--secrets` is passed.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import {
	type CredentialProvider,
	storedCredentials,
} from '../deploy/credentials.js';
import { dnsRecordFqdn, dnsResources } from '../deploy/dnsResources.js';
import { deployIdentity } from '../deploy/identity.js';
import { createStateStore, type StateStore } from '../deploy/StateStore.js';
import { GkmError } from '../errors';
import { canPrompt, prompt } from '../prompt';
import {
	type AwsProvisioning,
	awsProvisioningCredentials,
} from '../providers/aws.js';
import {
	AWS_RESOURCE_TYPES,
	type AwsDestroyInput,
	type AwsDestroyStep,
	planAwsDestroy,
} from '../providers/s3/destroy.js';
import { secretsStoreFor } from '../secrets/store.js';
import { stackOverrideFile } from '../target/compose/index';
import type { DnsProvider } from '../target/dokploy/dns/DnsProvider.js';
import {
	extractSubdomain,
	findRootDomain,
	normalizeDnsConfig,
} from '../target/dokploy/dns/index.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type {
	DnsProvider as DnsProviderConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import {
	dnsCredentials,
	pruneStackDns,
	type RecordedDnsRecord,
	recordTtl,
} from './dns';
import { type ComposeDocker, dockerCompose, type StackRef } from './docker';
import { edgeRef, removeEdgeRoutes } from './edge';
import { composeServer, dockerHost, sshTarget } from './server';
import { composeProject, stackDir } from './stack';
import { EDGE_PROJECT } from './traefik';

export interface ComposeDestroyOptions {
	cwd?: string;
	stage: string;
	/** Delete the stage's secrets too. Kept otherwise. */
	secrets?: boolean;
	/** Print what would be deleted; delete nothing, ask nothing. */
	dryRun?: boolean;
}

export interface ComposeDestroyDeps {
	docker?: ComposeDocker;
	/** Whether a person is at a terminal to answer. */
	interactive?: () => boolean;
	/** Ask the person, and resolve with what they typed. */
	ask?: (question: string) => Promise<string>;
	/** Where the DNS providers' tokens come from. */
	credentials?: CredentialProvider;
	/** The provider for a domain — `createDnsProvider` by default. */
	dnsProviderFor?: (config: DnsProviderConfig) => Promise<DnsProvider | null>;
	/** The AWS account's credential, rather than the machine's. */
	awsCredential?: AwsProvisioning;
	/** For tests: the AWS clients and how long a distribution is waited on. */
	aws?: Pick<AwsDestroyInput, 'clients' | 'wait'>;
	state?: StateStore;
	env?: NodeJS.ProcessEnv;
	home?: string;
	log?: (line: string) => void;
}

/** A destroy with no terminal to type the stage's name at. */
export class ComposeDestroyNeedsTerminal extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
	) {
		super(
			`Destroying '${stage}' deletes everything its deploys made, and asks you to ` +
				`type ${project} first — there is no terminal here to ask at, and no flag ` +
				'answers it. Run it yourself, from a terminal. `--dry-run` prints what it ' +
				'would delete, anywhere.',
		);
		this.name = 'ComposeDestroyNeedsTerminal';
	}
}

/** What was typed was not the project's name. */
export class ComposeDestroyNotConfirmed extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
	) {
		super(
			`Nothing was deleted: destroying '${stage}' needs ${project} typed exactly.`,
		);
		this.name = 'ComposeDestroyNotConfirmed';
	}
}

/** AWS resources to delete, and no credentials to delete them with. */
export class ComposeDestroyNeedsAwsCredentials extends GkmError {
	constructor(
		readonly stage: string,
		readonly resources: readonly string[],
	) {
		super(
			`'${stage}' has ${resources.length} AWS resource${resources.length === 1 ? '' : 's'} ` +
				`to delete (${resources.slice(0, 3).join(', ')}${resources.length > 3 ? ', …' : ''}), ` +
				"and no AWS credentials were found to delete them with. Supply the stage's " +
				'account the way a deploy does — AWS_PROFILE, or AWS_ACCESS_KEY_ID and ' +
				'AWS_SECRET_ACCESS_KEY — and run it again. Nothing was deleted.',
		);
		this.name = 'ComposeDestroyNeedsAwsCredentials';
	}
}

/** `--secrets`, and a store that cannot delete. */
export class SecretsStoreCannotDelete extends GkmError {
	constructor(
		readonly stage: string,
		readonly store: string,
	) {
		super(
			`--secrets deletes '${stage}''s secrets, and its store (${store}) has no ` +
				'delete(stage). Give the custom store one, or run without --secrets and ' +
				'delete them where they are kept. Nothing was deleted.',
		);
		this.name = 'SecretsStoreCannotDelete';
	}
}

/** One line of the plan, and how it is carried out. */
interface Step {
	label: string;
	leftAlone?: string;
	/** Forgotten from the stage's state once done. */
	keys?: string[];
	run?: () => Promise<void>;
}

/** What a record of each type is to destroy. */
const KEPT_TYPES: Record<string, string> = {
	// The server's setup — its users, firewall, Docker — is the server's.
	server:
		"the server's setup is kept: gkm compose:server made it, for any stage",
};

/** Records that name no resource of their own — a key in the secrets. */
const VALUE_TYPES = new Set(['url']);

/**
 * The stage's stack: its project on the server (or this machine), as
 * `gkm compose --down` finds it.
 */
export async function composeStackRef(
	workspace: NormalizedWorkspace,
	stage: string,
): Promise<{
	ref: StackRef;
	dir: string;
	server?: ReturnType<typeof composeServer>;
}> {
	const local = stage === workspace.stages.local;
	const server = local
		? undefined
		: composeServer({
				stage,
				local,
				config: workspace.deploy?.compose?.server,
				custom: (await (await secretsStoreFor(workspace, stage)).read(stage))
					?.custom,
			});
	const override = stackOverrideFile(workspace.root, stage);
	const dir = join(workspace.root, stackDir(stage));
	const ref: StackRef = {
		project: composeProject(deployIdentity(workspace, stage)),
		file: join(dir, 'docker-compose.yml'),
		...(existsSync(override) ? { overrides: [override] } : {}),
		cwd: workspace.root,
		...(server ? { host: dockerHost(server) } : {}),
	};
	return { ref, dir, ...(server ? { server } : {}) };
}

/** `gkm compose --stage <stage> --destroy`. */
export async function composeDestroyCommand(
	options: ComposeDestroyOptions,
	deps: ComposeDestroyDeps = {},
): Promise<void> {
	const log = deps.log ?? ((line: string) => console.log(line));
	const env = deps.env ?? process.env;
	const cwd = resolve(options.cwd ?? process.cwd());
	const { workspace } = await loadWorkspaceConfig(cwd);
	const { stage } = options;
	const local = stage === workspace.stages.local;
	if (!local) assertDeployedStage(workspace.stages, stage);

	const identity = deployIdentity(workspace, stage);
	const project = composeProject(identity);
	const interactive = deps.interactive ?? canPrompt;
	if (!options.dryRun && !interactive()) {
		throw new ComposeDestroyNeedsTerminal(stage, project);
	}

	const state =
		deps.state ??
		(await createStateStore({
			config: local ? undefined : workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
			namespace: workspace.deploy?.namespace,
		}));
	// Held throughout: a deploy of the stage while it is torn down would
	// make what this is deleting.
	const lock = options.dryRun
		? undefined
		: await state.lock(stage, { operation: 'destroy' });
	try {
		const steps = await plan(workspace, stage, options, deps, state, env);
		const { ref } = await composeStackRef(workspace, stage);

		log(
			`\n🧨 ${options.dryRun ? 'Would delete' : 'This deletes'} stage '${stage}' of ${workspace.name} for good:\n`,
		);
		const doing = steps.filter((s) => !s.leftAlone);
		const kept = steps.filter((s) => s.leftAlone);
		for (const step of doing) log(`   - ${step.label}`);
		if (kept.length > 0) {
			log('\n   Left where it is:');
			for (const step of kept) log(`   · ${step.label} — ${step.leftAlone}`);
		}
		if (!options.secrets) {
			log(
				"\n   The stage's secrets are kept: a deploy of it again reuses them. --secrets deletes them too.",
			);
		}

		if (options.dryRun) {
			log('\n--dry-run: nothing was deleted.');
			return;
		}

		const ask =
			deps.ask ??
			((question: string) =>
				prompt(question, {
					instead: 'Run it yourself, from a terminal.',
				}));
		const typed = await ask(`\n   Type ${project} to destroy it: `);
		if (typed.trim() !== project) {
			throw new ComposeDestroyNotConfirmed(stage, project);
		}

		log('');
		for (const step of doing) {
			await step.run?.();
			for (const key of step.keys ?? []) {
				await state.deleteResource(stage, key);
			}
			log(`   ✓ ${step.label}`);
		}
		log(`\n💥 '${stage}' destroyed. ${ref.project} is gone.`);
	} finally {
		await lock?.release();
	}
}

/** Every step, in the order it is carried out. */
async function plan(
	workspace: NormalizedWorkspace,
	stage: string,
	options: ComposeDestroyOptions,
	deps: ComposeDestroyDeps,
	state: StateStore,
	env: NodeJS.ProcessEnv,
): Promise<Step[]> {
	const steps: Step[] = [];
	const resources = (await state.read(stage))?.resources ?? {};
	const records = Object.values(resources);

	// ── The stack: containers, volumes, its routes on the edge ─────────────
	const { ref, dir, server } = await composeStackRef(workspace, stage);
	const docker = deps.docker ?? dockerCompose;
	steps.push({
		label: `${server ? `on ${sshTarget(server)}: ` : ''}stack ${ref.project} — its containers, its volumes and their data, its routes on ${EDGE_PROJECT}`,
		run: async () => {
			const edgeFile = join(dir, `${EDGE_PROJECT}.yml`);
			if (server || existsSync(edgeFile)) {
				await removeEdgeRoutes(
					docker,
					edgeRef(edgeFile, { host: ref.host }),
					ref.project,
				);
			}
			await docker.down(ref, { volumes: true });
		},
	});

	// ── AWS ─────────────────────────────────────────────────────────────────
	const aws = records.filter((r) =>
		(AWS_RESOURCE_TYPES as readonly string[]).includes(r.type),
	);
	let cdnDns: RecordedDnsRecord[] = [];
	if (aws.length > 0) {
		const credential =
			deps.awsCredential ??
			(await awsProvisioningCredentials({
				stage,
				env,
				...(deps.home ? { home: deps.home } : {}),
			}));
		if (!credential) {
			throw new ComposeDestroyNeedsAwsCredentials(
				stage,
				aws.map((r) => r.key),
			);
		}
		const identity = deployIdentity(workspace, stage);
		const planned = await planAwsDestroy({
			resources,
			identityKey: identity.key,
			scope: identity.scope,
			stage,
			credential,
			...(deps.aws ?? {}),
		});
		for (const step of planned.steps) steps.push(awsStep(step));
		cdnDns = providerDnsRecords(workspace, planned.dns);
	}

	// ── DNS: what the stage recorded, and what its CDN was given ───────────
	const recorded = dnsResources(resources).map((r) => ({
		...r,
		fqdn: r.fqdn || dnsRecordFqdn(r.domain, r.name),
	}));
	const seen = new Set(recorded.map((r) => `${r.fqdn} ${r.type}`));
	const dnsRecords: RecordedDnsRecord[] = [
		...recorded,
		...cdnDns.filter((r) => !seen.has(`${r.fqdn} ${r.type}`)),
	];
	if (dnsRecords.length > 0) {
		// The providers' tokens are read now: a missing one stops the destroy
		// before anything is deleted, rather than after the stack is gone.
		const dns = workspace.dns ? normalizeDnsConfig(workspace.dns) : {};
		const domains = [...new Set(dnsRecords.map((r) => r.domain))]
			.filter((domain) => dns[domain])
			.map((domain) => ({ domain, config: dns[domain]! }));
		const tokens = await dnsCredentials(
			stage,
			domains,
			deps.credentials ?? storedCredentials({ env }),
		);
		const log = deps.log ?? ((line: string) => console.log(line));
		steps.push({
			label: `DNS: ${dnsRecords.map((r) => `${r.type} ${r.fqdn}`).join(', ')} — each only while it holds the value gkm wrote`,
			keys: recorded.map(
				(r) => `dns-record:${r.fqdn.toLowerCase()}:${r.type.toUpperCase()}`,
			),
			run: async () => {
				await pruneStackDns(dnsRecords, {
					stage,
					dns: workspace.dns,
					log,
					credentials: {
						...(tokens.godaddy ? { credential: tokens.godaddy } : {}),
						log,
					},
					...(tokens.hostinger ? { hostinger: tokens.hostinger } : {}),
					...(deps.dnsProviderFor ? { providerFor: deps.dnsProviderFor } : {}),
				});
			},
		});
	}

	// ── What gkm cannot delete, and what names nothing ──────────────────────
	const handled = new Set<string>([
		...(AWS_RESOURCE_TYPES as readonly string[]),
		'dns-record',
	]);
	const values = records.filter((r) => VALUE_TYPES.has(r.type));
	for (const record of records) {
		if (handled.has(record.type) || VALUE_TYPES.has(record.type)) continue;
		steps.push({
			label: `${record.type} ${record.id ?? record.key}`,
			leftAlone:
				KEPT_TYPES[record.type] ??
				`gkm does not delete a ${record.type} yet: delete it by hand`,
		});
	}

	// ── The stage's secrets ────────────────────────────────────────────────
	if (options.secrets) {
		const store = await secretsStoreFor(workspace, stage, {
			...(deps.home ? { home: deps.home } : {}),
		});
		if (!store.delete) throw new SecretsStoreCannotDelete(stage, store.name);
		steps.push({
			label: `the stage's secrets, in its ${store.name} store`,
			// The keys the deleted resources were reached by go with them.
			keys: values.map((r) => r.key),
			run: () => store.delete!(stage),
		});
	} else if (values.length > 0) {
		// Their resources are gone; the keys stay in the kept secrets, and a
		// deploy writes them again.
		steps.push({
			label: `${values.length} record${values.length === 1 ? '' : 's'} of keys written into the secrets`,
			keys: values.map((r) => r.key),
		});
	}

	return steps;
}

function awsStep(step: AwsDestroyStep): Step {
	if (step.leftAlone) return { label: step.label, leftAlone: step.leftAlone };
	return {
		label: step.gone ? `${step.label} (already gone)` : step.label,
		keys: [step.key],
		...(step.remove ? { run: step.remove } : {}),
	};
}

/** The CDN's records, as the DNS prune takes them. */
function providerDnsRecords(
	workspace: NormalizedWorkspace,
	records: readonly { host: string; type: 'CNAME'; value: string }[],
): RecordedDnsRecord[] {
	const dns = workspace.dns ? normalizeDnsConfig(workspace.dns) : {};
	const out: RecordedDnsRecord[] = [];
	for (const record of records) {
		const host = record.host.toLowerCase().replace(/\.$/, '');
		const domain = findRootDomain(host, dns);
		if (!domain) continue;
		const config = dns[domain]!;
		out.push({
			fqdn: host,
			domain,
			name: extractSubdomain(host, domain),
			type: record.type,
			value: record.value.replace(/\.$/, ''),
			ttl: recordTtl(config),
			...(typeof config.provider === 'string'
				? { provider: config.provider }
				: {}),
		});
	}
	return out;
}
