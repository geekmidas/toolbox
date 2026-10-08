/**
 * `gkm dev:credentials` — where to sign in to each local service, and as
 * whom, without starting anything.
 *
 * Reads the workspace's generated local logins (see
 * `reconcile/localCredentials.ts`) and the ports the last `gkm dev` or
 * `gkm test` published them on (`.gkm/ports.json`). `--json` prints the same
 * for a script.
 */

import { loadWorkspaceConfig } from '../config.js';
import { loadPortState } from '../credentials/index.js';
import { portsOf } from '../reconcile/containers.js';
import {
	type LocalCredentials,
	readLocalCredentials,
} from '../reconcile/localCredentials.js';
import {
	describeLogins,
	type LocalLogs,
	type ServiceLogin,
	serviceLogins,
} from '../reconcile/serviceLogins.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** The containers a person may sign in to, in the order they print. */
const SIGNED_IN = [
	'postgres',
	'minio',
	'mailpit',
	'redis',
	'redis-http',
	'rabbitmq',
	'localstack',
] as const;

/** Nothing has generated this workspace's local logins yet. */
export class NoLocalCredentials extends Error {
	constructor(readonly workspace: string) {
		super(
			`'${workspace}' has no local logins on this machine yet: they are generated the first time gkm dev, gkm test or gkm setup starts its services. Run one of them, then this again.`,
		);
		this.name = 'NoLocalCredentials';
	}
}

/** What the command prints with `--json`. */
export interface DevCredentialsOutput {
	workspace: string;
	stage: string;
	services: ServiceLogin[];
}

/** The logins of every service the workspace last published. */
export function devCredentials(
	workspace: Pick<NormalizedWorkspace, 'name' | 'stages' | 'deploy'>,
	credentials: LocalCredentials,
	ports: Readonly<Record<string, number>>,
): DevCredentialsOutput {
	const containers = SIGNED_IN.filter((container) =>
		portsOf(container).some((port) => ports[port.key] !== undefined),
	);
	// The OpenObserve `gkm dev` runs for a workspace that uses a `Telemetry`
	// construct — the local stage's compose stack signs in the same way.
	const local: LocalLogs | undefined =
		ports.openobserve !== undefined
			? { url: `http://localhost:${ports.openobserve}`, via: 'gkm dev' }
			: undefined;
	return {
		workspace: workspace.name,
		stage: workspace.stages.local,
		services: serviceLogins({
			containers,
			ports,
			credentials,
			...(local ? { logs: local } : {}),
		}),
	};
}

export async function devCredentialsCommand(
	options: { json?: boolean } = {},
	print: (line: string) => void = (line) => console.log(line),
): Promise<DevCredentialsOutput> {
	const { workspace } = await loadWorkspaceConfig(process.cwd());
	const credentials = await readLocalCredentials(workspace);
	if (!credentials) throw new NoLocalCredentials(workspace.name);

	const output = devCredentials(
		workspace,
		credentials,
		await loadPortState(workspace.root),
	);

	if (options.json) {
		print(JSON.stringify(output, null, 2));
		return output;
	}

	print(`🔑 Local logins for ${output.workspace} (${output.stage})`);
	if (output.services.length === 0) {
		print(
			'   No service has been published yet — start them with gkm dev, then run this again.',
		);
	}
	for (const line of describeLogins(output.services)) print(line);
	return output;
}
