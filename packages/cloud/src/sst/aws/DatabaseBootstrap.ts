import * as aws from '@pulumi/aws';
import { secretsmanager } from '@pulumi/aws';
import { RandomPassword } from '@pulumi/random';
import type { BootstrapTenant } from './bootstrap/handler';
import type { Database } from './Database';

/**
 * The roles a tenant needs, provisioned — and the function that creates them.
 *
 * Two halves that only make sense together. Pulumi can generate a password and
 * store it; it cannot run `CREATE ROLE`. So the passwords are resources here and
 * the DDL is a Lambda invoked once per deploy, inside the VPC, connecting as the
 * cluster master — the only credential that exists before any role does.
 *
 * **One secret per tenant, not one holding all of them.** A shared secret would
 * defeat the thing the role split exists for: a function that could read it
 * could connect as *any* role, so the application's role could not read the auth
 * schema's tables but could read the auth schema's password. Per-tenant keeps
 * IAM able to grant exactly one, and keeps rotation per-tenant too.
 *
 * :::caution
 * Not verified against a live deploy. The shape is sound and every decision in
 * it is asserted as data, but no stack has come up.
 * :::
 */
export class DatabaseBootstrap {
	/** The generated passwords, by role name. */
	private readonly passwords = new Map<string, $util.Output<string>>();

	/** The per-tenant secrets, by construct id. */
	readonly secrets = new Map<string, secretsmanager.Secret>();

	private readonly tenants: BootstrapTenant[] = [];

	constructor(
		private readonly name: string,
		private readonly cluster: Database,
	) {}

	/**
	 * Add a tenant to bootstrap, and provision its credentials.
	 *
	 * Returns the runtime password so the tenant's URL can carry it. The value is
	 * a Pulumi output either way — it exists in state whether or not it is also
	 * in Secrets Manager — so putting it in the URL adds no exposure the link did
	 * not already have.
	 */
	add(tenant: {
		id: string;
		schema: string;
		runtime: string;
		owner: string;
		reader?: string;
	}): { runtime: $util.Output<string>; reader?: $util.Output<string> } {
		const runtime = this.password(tenant.runtime);
		const owner = this.password(tenant.owner);
		const reader = tenant.reader ? this.password(tenant.reader) : undefined;

		this.secrets.set(
			tenant.id,
			new secretsmanager.Secret(`${this.name}${tenant.id}Credentials`, {
				// The construct id in the name, because the point of one secret per
				// tenant is that a human granting access can tell which is which.
				namePrefix: `${this.name}/${tenant.id}/`,
				description: `Database roles for ${tenant.id}`,
			}),
		);

		new secretsmanager.SecretVersion(
			`${this.name}${tenant.id}CredentialsValue`,
			{
				secretId: this.secrets.get(tenant.id)!.id,
				secretString: $util
					.all([runtime, owner, reader ?? $util.output('')])
					.apply(([runtimeValue, ownerValue, readerValue]) =>
						JSON.stringify({
							runtime: runtimeValue,
							owner: ownerValue,
							...(readerValue ? { reader: readerValue } : {}),
						}),
					),
			},
		);

		this.tenants.push({
			id: tenant.id,
			schema: tenant.schema,
			runtime: tenant.runtime,
			owner: tenant.owner,
			...(tenant.reader ? { reader: tenant.reader } : {}),
			// Filled in by `bootstrapEvent` once the outputs resolve. The function
			// reads them straight out of its input and never fetches a secret, so
			// it needs no IAM to read one.
			passwords: { runtime: '', owner: '' },
		});

		return { runtime, ...(reader ? { reader } : {}) };
	}

	/**
	 * The event this bootstrap should be invoked with.
	 *
	 * Kept as data rather than performed here, so the caller decides *when* — and
	 * so the decision is assertable without Pulumi. Feed it to a function
	 * invocation whose input changes when this changes, which is what makes a
	 * re-deploy re-apply only when something actually moved.
	 */
	event(): $util.Output<string> {
		// Every password, flat, so one `all` resolves them and the shape is put
		// back together by a pure function that can be asserted without Pulumi.
		const roles = [...this.passwords.keys()];

		return $util
			.all([
				this.cluster.host as $util.Input<unknown>,
				this.cluster.port,
				this.cluster.database,
				this.cluster.username,
				this.cluster.password,
				...roles.map((role) => this.passwords.get(role)!),
			] as $util.Input<unknown>[])
			.apply((resolved) => {
				const [host, port, database, username, password, ...secrets] =
					resolved as unknown as [
						string,
						number,
						string,
						string,
						string,
						...string[],
					];

				return bootstrapEvent(
					{ host, port, database, username, password },
					this.tenants,
					new Map(roles.map((role, index) => [role, secrets[index] as string])),
				);
			});
	}

	/**
	 * The read-only credential for a runtime role, once its tenant is added.
	 *
	 * Returns nothing where no reader was provisioned — a reader role is created
	 * only where something points at one, so asking for one that was never asked
	 * for is a question with a real answer rather than an error.
	 */
	readerFor(
		runtime: string,
	): { user: string; password: $util.Output<string> } | undefined {
		const role = `${runtime}_reader`;
		const password = this.passwords.get(role);

		return password ? { user: role, password } : undefined;
	}

	/** Whether anything needs bootstrapping at all. */
	get empty(): boolean {
		return this.tenants.length === 0;
	}

	/**
	 * Create the function and invoke it once for this deploy.
	 *
	 * The invocation's input is `event()`, so it re-runs when — and only when —
	 * the roles, the schemas, or the cluster's address actually change. A deploy
	 * that touched neither costs nothing, which is what makes running this on
	 * every deploy acceptable rather than something to remember.
	 *
	 * @param vpc the cluster's VPC. The function has to reach the database, and
	 * a database reachable from outside its VPC is the problem this avoids.
	 */
	run(vpc: sst.aws.AuroraArgs['vpc']): void {
		if (this.empty) return;

		const fn = new sst.aws.Function(`${this.name}Bootstrap`, {
			// Shipped by this package rather than by the application: the DDL is
			// the framework's, and an app that had to carry a bootstrap handler
			// could get it wrong.
			handler: HANDLER,
			runtime: 'nodejs22.x',
			// Long enough for a cold Aurora Serverless v2 cluster to wake up —
			// `min: 0 ACU` means the first connection of the day pays for a
			// resume, and timing out there would leave a half-bootstrapped schema.
			timeout: '5 minutes',
			// The two components spell the same VPC differently — a cluster names
			// the subnets it lives in, a function names the private ones it runs
			// in — and they are the same subnets. Translated here rather than
			// asked for twice.
			vpc: functionVpc(vpc),
			nodejs: { install: ['pg'] },
		});

		new aws.lambda.Invocation(`${this.name}BootstrapRun`, {
			functionName: fn.name,
			input: this.event(),
		});
	}

	private password(role: string): $util.Output<string> {
		const existing = this.passwords.get(role);
		if (existing) return existing;

		const generated = new RandomPassword(`${this.name}${role}Password`, {
			length: 32,
			// Postgres accepts these in a password; a `'` would need escaping in
			// DDL and a `/` breaks a URL's authority section, so neither is worth
			// the risk for entropy this module has plenty of.
			special: true,
			overrideSpecial: '-_',
		}).result;

		this.passwords.set(role, generated);

		return generated;
	}
}

/**
 * Where the bootstrap handler lives, from the application's root.
 *
 * A path into this package's own published files, so an app that installed
 * `@geekmidas/cloud` gets the handler without copying it — and so a fix to the
 * DDL reaches every app on the next upgrade rather than the next time somebody
 * remembers.
 *
 * `src/`, not `dist/`: `src/sst/**` is published as raw TypeScript on purpose,
 * because it extends ambient globals that only exist inside a consuming SST
 * app. SST bundles the handler with esbuild at deploy, which is the same thing
 * it does for the application's own handlers.
 */
const HANDLER =
	'node_modules/@geekmidas/cloud/src/sst/aws/bootstrap/handler.handler';

/** An Aurora VPC argument as the shape a function takes. */
function functionVpc(
	vpc: sst.aws.AuroraArgs['vpc'],
): sst.aws.FunctionArgs['vpc'] {
	// A `Vpc` component satisfies both, so it passes straight through.
	if (!vpc || typeof vpc !== 'object' || !('subnets' in vpc)) {
		return vpc as sst.aws.FunctionArgs['vpc'];
	}

	const { subnets, securityGroups } = vpc as {
		subnets: $util.Input<$util.Input<string>[]>;
		securityGroups: $util.Input<$util.Input<string>[]>;
	};

	return { privateSubnets: subnets, securityGroups };
}

/**
 * The bootstrap's input, assembled from resolved values.
 *
 * Pure, and separate from the component for the reason every decision in this
 * package is: composing it needs no Pulumi, so what the function will be handed
 * can be asserted without a deploy — including that it is exactly what
 * `roleStatements` accepts, which is the contract between the two halves.
 */
export function bootstrapEvent(
	master: {
		host: string;
		port: number;
		database: string;
		username: string;
		password: string;
	},
	tenants: readonly BootstrapTenant[],
	passwords: ReadonlyMap<string, string>,
): string {
	return JSON.stringify({
		master,
		tenants: tenants.map((tenant) => ({
			...tenant,
			passwords: {
				runtime: passwords.get(tenant.runtime) ?? '',
				owner: passwords.get(tenant.owner) ?? '',
				...(tenant.reader
					? { reader: passwords.get(tenant.reader) ?? '' }
					: {}),
			},
		})),
	});
}
