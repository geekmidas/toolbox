/**
 * The URLs a reconciled stage injects.
 *
 * One `<NAME>_URL` per construct, and the protocol picks the driver. This is the
 * seam between the target that writes a URL and the client that parses it, so
 * every component of it is read off the resource — never inherited from ambient
 * environment. A bucket can live in a different region than the function reading
 * it, and `AWS_REGION` in a Lambda is the *function's* region, so a URL that
 * omits `?region=` breaks cross-region silently at runtime.
 *
 * Locally that self-containment is what lets the port be whatever was free: the
 * app reads `ORDERS_URL` and never sees a host or a port.
 */

import { createHash } from 'node:crypto';
import { formatKeyring } from '@geekmidas/constructs/encryption';
import { ownerRole, readerRole } from '@geekmidas/db/pg/roles';
import * as snsUrl from '@geekmidas/events/sns/url';
import * as sqsUrl from '@geekmidas/events/sqs/url';
import {
	cacheTable,
	cookieDomain,
	externalApiUrl,
	mobileOrigins,
	provideKey,
	schemeBase,
} from '@geekmidas/manifest';
import { LOGS_ORG, otlpHeaders } from '../compose/logs.js';
import { GkmError } from '../errors';
import { telemetryEnv } from '../telemetry/config.js';
import { hostFor } from './caddyfile';
import { primaryPortKey } from './containers';
import {
	EMULATOR_REGION,
	emulatorEndpoint,
	emulatorQueueUrl,
	emulatorTopicArn,
} from './emulator';
import type { ContainerCredentials } from './localCredentials';
import { PgBossNeedsDatabase, type Plan, type PlannedResource } from './plan';
import type { PortAssignments } from './ports';

/** The host containers are published on. */
const LOCAL_HOST = 'localhost';

/** The region local buckets claim, so the client has one to sign with. */
const LOCAL_REGION = 'us-east-1';

/**
 * The credentials the S3 client resolves for MinIO.
 *
 * An `s3://` URL deliberately carries none: deployed, the SDK reads them from
 * the execution role, so a URL that embedded a key would be one more thing to
 * rotate and one more thing to leak into a log. Locally there is no role, and
 * the same chain reads these — which is why they are injected beside the URL
 * rather than written into it.
 */
function storageCredentials(
	credentials: ContainerCredentials,
): Record<string, string> {
	return {
		AWS_ACCESS_KEY_ID: credentials.minio.user,
		AWS_SECRET_ACCESS_KEY: credentials.minio.password,
		AWS_REGION: LOCAL_REGION,
	};
}

/** The port Mailpit's inbox — its web UI and HTTP API — is published under. */
const MAILPIT_INBOX_PORT = 'mailpit-web';

/** The schema pg-boss keeps its tables in, inside the declared database. */
const PGBOSS_SCHEMA = 'pgboss';

/** The exchange every local topic and queue shares on RabbitMQ. */
const RABBITMQ_EXCHANGE = 'gkm.events';

export interface EnvOptions {
	/** Assigned ports, keyed by port key. */
	ports: PortAssignments;
	/**
	 * The project, which seeds any secret this stage derives.
	 *
	 * Derived rather than random so it survives a restart -- a signing key that
	 * changed on every `gkm dev` would invalidate every session you were in the
	 * middle of -- and seeded by the project so two checkouts do not share one.
	 */
	project?: string;
	/**
	 * Where each address-owning construct answers, keyed by id — surfaces and
	 * sites, e.g. `{ Api: 'http://localhost:3000', Console: 'http://localhost:5173' }`.
	 *
	 * Not container addresses: `gkm dev` assigns these, which is why they arrive
	 * here rather than being read off a published port. Keyed by id rather than
	 * being one `surface` string because there is more than one address in a
	 * workspace and the difference between them is exactly what CORS is about.
	 */
	addresses?: Readonly<Record<string, string>>;
	/**
	 * This machine's address on the local network — what a phone running the
	 * app reaches it on. Only a local stage has one, and only a project with a
	 * mobile app reads it: its `exp://` origins, and the address sign-in links
	 * for the app are built on.
	 */
	lanAddress?: string;
	/** Each mobile app's Metro port, by id — the exact port its `exp://` origins name. */
	metroPorts?: Readonly<Record<string, number>>;
	/**
	 * The domain mail is sent from locally.
	 *
	 * Stage config, exactly as it is deployed — the difference is only that here
	 * nobody had to verify it.
	 */
	mailFrom?: string;
	/**
	 * The stage's random seed, salting every derived role password.
	 *
	 * The local stages' is generated once per machine with their logins; a
	 * stack that serves a deployed stage passes the seed its store keeps, so
	 * its passwords are the ones a deploy derives. Either way they are not
	 * computable from the repo.
	 */
	seed?: string;
	/**
	 * What every container was brought up with — the cluster's superuser,
	 * MinIO's root, the cache's token, the emulator's key pair.
	 *
	 * pg-boss and a `roles: false` database connect as the superuser, so its
	 * login is in their URLs.
	 */
	credentials: ContainerCredentials;
}

/**
 * The credentials a stage's URLs carry: the containers' logins and the seed
 * role passwords are salted with.
 */
interface StageCredential {
	containers: ContainerCredentials;
	seed?: string;
}

/** The credential `options` describe. */
function credentialOf(options: {
	seed?: string;
	credentials: ContainerCredentials;
}): StageCredential {
	return {
		containers: options.credentials,
		...(options.seed ? { seed: options.seed } : {}),
	};
}

/**
 * Every env key a reconciled plan resolves, and its value.
 *
 * Keys come from the declaration rather than being re-derived, so what the build
 * publishes and what the app reads cannot drift.
 */
export function envFor(
	plan: Plan,
	options: EnvOptions,
): Record<string, string> {
	const env: Record<string, string> = {};
	const credential = credentialOf(options);

	// Resolved once, up front, because a surface's cookie domain and origin list
	// are derived from *other constructs'* addresses — and reading them as the
	// loop happened to reach them would make the answer depend on the order the
	// manifest was keyed in.
	const resolved: Record<string, string> = {};
	for (const resource of plan.resources) {
		const url = urlFor(
			resource,
			plan,
			options.ports,
			options.project ?? '',
			options.addresses,
			credential,
		);
		if (url) resolved[resource.id] = url;
	}

	for (const resource of plan.resources) {
		const url = resolved[resource.id];

		// A surface carries the origins its callers may come from, and they are
		// its inbound edges — nothing more. Better Auth's CSRF check applies to
		// every caller and not only to browsers, so a sibling service calling it
		// is rejected unless its origin is listed; that this list is now the
		// graph rather than every app the workspace happens to run is what makes
		// it the same list deployed, where no workspace is watching.
		if (resource.kind === 'rest-api') {
			Object.assign(
				env,
				surfaceEnv(resource, url, resolved, {
					plan,
					...(options.addresses ? { addresses: options.addresses } : {}),
					...(options.lanAddress ? { lanAddress: options.lanAddress } : {}),
					...(options.metroPorts ? { metroPorts: options.metroPorts } : {}),
				}),
			);
		}
		if (url) env[resource.envKey] = url;

		// A database owns a second key, and it is deliberately not in `provides`:
		// the owner URL is what a migrator connects with, so no edge in any
		// manifest can name it and nothing can be granted DDL rights by mistake.
		// `gkm exec` injects it; a handler never sees it.
		if (isDatabase(resource.kind) && resource.roles !== false) {
			const owner = ownerUrl(
				resource,
				plan,
				options.ports,
				options.project ?? '',
				credential,
			);
			if (owner) env[provideKey(resource.id, 'ownerUrl')] = owner;
		}

		// An external API owns a second key. Faked, it is the fake's; otherwise
		// it is the stage's own, from its secrets like any value it was given.
		if (resource.kind === 'external-api' && url && resource.fake) {
			env[provideKey(resource.id, 'credentials')] = resource.fake.credentials;
		}

		// A credential resolves nothing (see `urlFor`) — unless the plan was
		// made with fakes and it has one: then the stage is handed the fake's
		// value in place of its own, as an external API is handed its fake's.
		if (
			resource.kind === 'credential' &&
			resource.fakeCredentials !== undefined
		) {
			env[resource.envKey] = resource.fakeCredentials;
		}

		// Telemetry owns the rest of OpenTelemetry's keys: how to sign in to
		// OpenObserve, and the sampler — every trace, locally. The service's
		// name is each process's own, so it is not resolved here.
		if (resource.kind === 'telemetry' && url) {
			const login = options.credentials.logs;
			Object.assign(
				env,
				telemetryEnv(
					{ endpoint: url, headers: otlpHeaders(login.email, login.password) },
					1,
				),
			);
		}

		// Mail owns a second key. It is the sending identity, which is the one
		// thing about mail that differs per stage — so it travels with the URL
		// rather than being written into the construct.
		if (resource.kind === 'email' && url) {
			env[provideKey(resource.id, 'from')] =
				options.mailFrom ?? `noreply@${LOCAL_HOST}`;

			// And, locally, a third: where the mail it sent can be read back.
			// Mailpit answers SMTP on one port and its inbox on another; a feature
			// test signs in by opening the email that was actually sent, and this
			// is how it finds it. Deployed mail has no inbox, so nothing deployed
			// publishes this key.
			const inbox = options.ports[MAILPIT_INBOX_PORT];
			if (inbox !== undefined) {
				env[provideKey(resource.id, 'inboxUrl')] =
					`http://${LOCAL_HOST}:${inbox}`;
			}
		}
	}

	// After the loop, and deliberately: a site's keys are renames of values the
	// constructs it depends on resolved, so every source has to exist before any
	// of them can be read. Doing it inline would make the result depend on the
	// order the manifest happened to be keyed in.
	Object.assign(env, publicEnv(plan, env, options.addresses));

	Object.assign(env, brokerEnv(plan, options.ports, credential));

	// Only once a bucket actually resolved: an unresolvable plan resolves
	// nothing, and credentials for a container that is not running are noise.
	if (plan.resources.some((r) => r.kind === 'objects' && env[r.envKey])) {
		Object.assign(env, storageCredentials(options.credentials));
	}

	return env;
}

/**
 * The values a site's bundler inlines, under the names it inlines them by.
 *
 * A rename and nothing more. `API_URL` was resolved once, by the same code that
 * resolved it for the server; a site reads the same value under `VITE_API_URL`
 * because that prefix is how its bundler is told to ship it. Nothing is derived
 * twice, so a site and its API cannot come to disagree about where the API is.
 *
 * A source that resolved to nothing is skipped rather than written empty: an
 * inlined empty string is a frontend that builds and then fails at runtime
 * against `http:///`, where a missing variable fails at build with the name of
 * the thing that is missing.
 */
function publicEnv(
	plan: Plan,
	resolved: Record<string, string>,
	/** Where each surface answers on its own port — what a mobile app is given. */
	addresses: Readonly<Record<string, string>> = {},
): Record<string, string> {
	const env: Record<string, string> = {};
	// Which construct each key belongs to, so a mobile app can be handed the
	// surface's own port rather than the edge's hostname.
	const owners = new Map(plan.resources.map((r) => [r.envKey, r.id]));

	for (const resource of plan.resources) {
		for (const [key, source] of Object.entries(resource.publicEnv ?? {})) {
			// A phone cannot open `https://api-dev.shop.localhost` — the hostname
			// resolves only on this machine, and the edge routes by it, so no LAN
			// address can stand in for it. The surface's own port can: the app
			// swaps `localhost` for the host Metro was served from, and reaches it.
			const direct =
				resource.kind === 'mobile-app'
					? addresses[owners.get(source) ?? '']
					: undefined;
			const value = direct ?? resolved[source];
			if (value) env[key] = value;
		}
	}

	return env;
}

/**
 * What a surface publishes beyond its own address: who may call it, and where
 * a cookie set by it is readable.
 *
 * Both are read off the same list — the constructs that declared an edge to
 * this surface — which is why neither appears in application code. A surface
 * that listed its own callers would be edited every time something new called
 * it, and the thing being edited is already recorded in the graph.
 *
 * An empty origin list is written, and a surface with no address writes nothing
 * at all. The two cases look alike and are not: "nothing depends on this yet" is
 * a real state a target should publish, while "this surface has no address here"
 * means it is not running in this stage, and keys belong with the address they
 * describe.
 */
function surfaceEnv(
	resource: PlannedResource,
	url: string | undefined,
	/**
	 * Every construct's *resolved* address, keyed by id — not the raw ones the
	 * workspace assigned.
	 *
	 * The difference is the feature. Behind the edge a surface and its callers
	 * are `api.shop.localhost` and `console.shop.localhost`, which share a
	 * parent and therefore a cookie; the addresses they were assigned are
	 * `localhost:3000` and `localhost:5173`, which are one host with two ports
	 * and share nothing. Deriving from the wrong one produces a local cookie
	 * model that is *different* from the deployed one rather than matching it.
	 */
	resolved: Readonly<Record<string, string>> = {},
	local: {
		plan?: Plan;
		addresses?: Readonly<Record<string, string>>;
		lanAddress?: string;
		metroPorts?: Readonly<Record<string, number>>;
	} = {},
): Record<string, string> {
	if (!url) return {};

	const origins = [
		...new Set(
			(resource.callers ?? [])
				.map((caller) => resolved[caller])
				.filter((address): address is string => Boolean(address))
				.map(originOf)
				.filter((origin): origin is string => Boolean(origin)),
		),
	].sort();

	// Its own address belongs in the cookie derivation but not in the origin
	// list: a surface does not need permission to call itself, and adding it
	// would make every surface trust every other one that shares a port.
	const domain = cookieDomain([url, ...origins]);

	// A mobile caller is reached by its scheme, not an address, so it adds its
	// scheme — and, on this local stage, the `exp://` hosts Expo Go sends from —
	// rather than an origin read off a URL. After the cookie domain on purpose:
	// a scheme is not a host anything shares a cookie with.
	const mobile = (resource.callers ?? [])
		.map((caller) =>
			local.plan?.resources.find(
				(r) => r.id === caller && r.kind === 'mobile-app',
			),
		)
		.filter((caller): caller is PlannedResource => Boolean(caller));
	const hosts = [...(local.lanAddress ? [local.lanAddress] : []), LOCAL_HOST];
	const schemes = mobile.flatMap((caller) => {
		const scheme = resolved[caller.id];
		const port = local.metroPorts?.[caller.id];
		return scheme
			? mobileOrigins(scheme, { hosts, ...(port ? { port } : {}) })
			: [];
	});

	// Where a phone reaches this surface: its own port on the LAN address. What
	// the auth server builds a sign-in link on when the app asked for it — the
	// link is opened on the phone, which cannot resolve the edge's hostname.
	const own = local.addresses?.[resource.id];
	const device =
		mobile.length > 0 && local.lanAddress && own
			? own.replace(
					/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/,
					`//${local.lanAddress}`,
				)
			: undefined;

	return {
		[provideKey(resource.id, 'trustedOrigins')]: [
			...origins,
			...new Set(schemes),
		].join(','),
		...(domain ? { [provideKey(resource.id, 'cookieDomain')]: domain } : {}),
		...(device ? { [provideKey(resource.id, 'deviceUrl')]: device } : {}),
	};
}

/** An address reduced to the origin a browser compares against. */
function originOf(address: string): string | undefined {
	try {
		return new URL(address).origin;
	} catch {
		return undefined;
	}
}

/**
 * The runtime role of whatever a derived node hangs off.
 *
 * A reader's parent may itself be a schema tenant, so this follows `of` by one
 * hop rather than assuming the cluster — the reader of a tenant reads that
 * tenant's schema, not the database's.
 */
function parentRole(resource: PlannedResource, plan: Plan): string {
	const parent = plan.resources.find((r) => r.id === resource.of);

	return parent ? localRole(parent) : resource.name;
}

/** Whether a kind connects to Postgres and therefore has an owner role. */
function isDatabase(kind: PlannedResource['kind']): boolean {
	return kind === 'database' || kind === 'database-schema';
}

/**
 * The URL a migrator connects with — the owner role, which can create, alter
 * and drop.
 *
 * Never in `provides`, which is the whole point. A handler that could reach this
 * could `DROP TABLE`, and the security property the role split exists for is
 * that it cannot: the value is injected by `gkm exec` for the migrate step and
 * by nothing else.
 */
function ownerUrl(
	resource: PlannedResource,
	plan: Plan,
	ports: PortAssignments,
	project: string,
	credential: StageCredential,
): string | undefined {
	if (!resource.container) return undefined;

	const port = ports[primaryPortKey(resource.container)];
	if (port === undefined) return undefined;

	const owner = ownerRole(localRole(resource));

	return postgres(port, rootDatabase(resource, plan), {
		user: owner,
		password: localRolePassword(project, plan, owner, credential.seed),
	});
}

/**
 * The shared broker keys, when anything is published or consumed.
 *
 * A queue's own key is the producer's. These two are the *connection* itself,
 * which locally is one broker for every queue and topic in the project: the
 * generated pollers open a single connection and subscribe each worker by name
 * on it. Deployed there is no such thing — a Lambda is handed its own event
 * source — so this pair exists for the local target and says so.
 */
function brokerEnv(
	plan: Plan,
	ports: PortAssignments,
	credential: StageCredential,
): Record<string, string> {
	const carrier = plan.resources.find(
		(r) => r.kind === 'queue' || r.kind === 'topic',
	);

	const publisher = carrier
		? urlFor(carrier, plan, ports, '', {}, credential)
		: plan.workerBroker
			? workerBroker(plan, ports, credential)
			: undefined;
	if (!publisher) return {};

	// One broker address only where there is one broker: pg-boss and RabbitMQ.
	// On SNS every topic and queue is its own address, carried by its own
	// `<ID>_PUBLISHER_CONNECTION_STRING`, and no single string stands for them.
	if (plan.events === 'sns') return {};

	return { EVENT_PUBLISHER_CONNECTION_STRING: publisher };
}

/**
 * The broker a worker schedules its crons through, when nothing else declared
 * one — pg-boss in the declared database, on that database's port.
 */
function workerBroker(
	plan: Plan,
	ports: PortAssignments,
	credential: StageCredential,
): string | undefined {
	const database = plan.resources.find((r) => r.kind === 'database');
	if (!database?.container) return undefined;

	const port = ports[primaryPortKey(database.container)];
	return port === undefined ? undefined : broker(plan, port, credential);
}

/**
 * The URL for one planned resource.
 *
 * Every part of it comes from the resource and the port it was published on.
 */
function urlFor(
	resource: PlannedResource,
	plan: Plan,
	ports: PortAssignments,
	project: string,
	addresses: Readonly<Record<string, string>> | undefined,
	credential: StageCredential,
): string | undefined {
	// A secret has no address, so there is no port to wait for.
	if (resource.kind === 'secret') return localSecret(project, plan, resource);

	// Nor has an encryption key: a keyring derived the way a secret is.
	if (resource.kind === 'encryption') {
		return localKeyring(project, plan, resource);
	}

	// A mobile app resolves its scheme — the same on every stage.
	if (resource.kind === 'mobile-app') {
		return schemeBase(project, resource.scheme);
	}

	// A credential resolves to nothing here, deliberately. A secret is derived
	// because the platform owns it; a credential was issued by a third party, so
	// inventing a value would produce a Stripe key that is not a Stripe key and
	// fail at the first call rather than at the first read. It comes from
	// `gkm secrets` or `.env` like any other supplied value, and the construct's
	// own schema is what reports it missing — or, on a stage that fakes, from
	// its fake (`envFor`).
	if (resource.kind === 'credential') return undefined;

	// An external API is the provider, at its URL for this stage — unless the
	// plan was made with fakes (`gkm test`, `gkm dev --fake`), and then it is
	// its fake, on the port its key was assigned.
	if (resource.kind === 'external-api') {
		if (!resource.fake) {
			return resource.url === undefined
				? undefined
				: externalApiUrl({ id: resource.id, url: resource.url }, plan.stage);
		}
		const port = ports[resource.fake.key];
		return port === undefined ? undefined : `http://${LOCAL_HOST}:${port}`;
	}

	// A surface answers on the app's own port, and a site on its dev server's —
	// both assigned by the workspace, neither published by a container.
	//
	// Behind the edge when there is one, which is what gives them a hostname and
	// a certificate rather than a port on localhost. The application cannot tell
	// the difference: it reads whichever address was injected and composes none,
	// so this is the target's decision alone.
	if (resource.kind === 'rest-api' || resource.kind === 'site') {
		const address = addresses?.[resource.id];
		const edge = plan.containers.includes('caddy')
			? ports[primaryPortKey('caddy')]
			: undefined;

		return address && edge !== undefined
			? `https://${hostFor(resource, project)}:${edge}`
			: address;
	}

	if (!resource.container) return undefined;

	const port = ports[primaryPortKey(resource.container)];
	if (port === undefined) return undefined;

	switch (resource.kind) {
		case 'database':
		case 'database-schema':
		case 'database-reader': {
			// A tenant and a reader both live in the *parent's* database; what
			// separates them is the role's grants and the `search_path` pinned on
			// that role, never a database of their own.
			const database = rootDatabase(resource, plan);

			// The runtime role, which can read and write rows and create nothing.
			// `search_path` is pinned on the role by the DDL rather than carried
			// here, so a connection string cannot forget it — and forgetting it
			// looks like an empty database rather than an error.
			//
			// `roles: false` is the documented downgrade: both URLs fall back to
			// the cluster's master credential, and the schema goes back into the
			// URL because there is no role to pin it on.
			if (resource.roles === false) {
				const schema = schemaOf(resource, plan);

				const master = credential.containers.postgres;
				return schema
					? `${postgres(port, database, master)}?search_path=${schema}`
					: postgres(port, database, master);
			}

			// A reader connects as the read-only role on its parent, not as a role
			// of its own: read-only is enforced by the grants, which is what makes
			// falling back to the writer's endpoint safe where no replica exists.
			const role =
				resource.kind === 'database-reader'
					? readerRole(parentRole(resource, plan))
					: localRole(resource);

			return postgres(port, database, {
				user: role,
				password: localRolePassword(project, plan, role, credential.seed),
			});
		}

		case 'telemetry':
			// OpenObserve takes OTLP/HTTP under its organisation's API.
			return `http://${LOCAL_HOST}:${port}/api/${LOGS_ORG}`;

		case 'email':
			// The same scheme the deployed target writes; only host and credentials
			// differ, which is what lets the client never branch on provider.
			return `smtp://${LOCAL_HOST}:${port}`;

		case 'objects':
			// `?endpoint=` is what points the same S3 client at MinIO — the client
			// is identical, only the URL differs. Path-style addressing goes with
			// it: virtual-host style resolves `bucket.localhost`, which is not
			// MinIO and not anything.
			return `s3://${resource.name}?region=${LOCAL_REGION}&endpoint=http://${LOCAL_HOST}:${port}&forcePathStyle=true`;

		case 'file-server': {
			// A host of its own, over TLS — the shape it has deployed, and the one
			// MinIO alone cannot produce: its virtual-host mode reads the leading
			// label *as the bucket name*, so it matches only when the server's id
			// and the bucket's agree and never for a server fronting two buckets.
			// The local edge in front of it does the mapping instead, and issues
			// the certificate. An AWS emulator supplies neither: CloudFront
			// emulation is control plane only, and this is the data plane.
			//
			// The port is in the address because ports are assigned rather than
			// fixed, so two projects can run at once. Nothing that reads a
			// hostname — a cookie domain, a CORS origin — looks at it.
			const origin = plan.resources.find((r) => r.id === resource.of);
			if (!origin) return undefined;

			// With the edge off, the honest local answer is the address that
			// works: a path under the object store. It is not the deployed shape,
			// and the application still cannot tell — it reads the key it was
			// given and never composes one.
			return plan.containers.includes('caddy')
				? `https://${hostFor(resource, project)}:${port}`
				: `http://${LOCAL_HOST}:${port}/${origin.name}`;
		}

		case 'cache':
			// The scheme is the backend, and the backend is the same one deployed —
			// which is what lets a driver registered at build time match the URL
			// resolved at run time.
			//
			// A cache in a database has no address of its own: no second host and
			// no second credential, just its parent's URL. Reached by following
			// `of` and nothing else — `planFor` has already resolved a
			// `cache: 'db'` backend into that edge, so there is one way a cache
			// lands in a database and one way to find out.
			if (resource.of) {
				const parent = plan.resources.find((r) => r.id === resource.of);
				const url = parent
					? urlFor(parent, plan, ports, project, addresses, credential)
					: undefined;

				// The parent's address plus the one thing that distinguishes this
				// cache from another in the same database: its table. Two caches on
				// one database resolve the same connection string, so without it a
				// client built from the URL cannot tell them apart.
				return url
					? withTable(url, resource.table ?? cacheTable(resource.id))
					: undefined;
			}

			switch (plan.cache) {
				case 'elasticache':
				case 'redis':
					// The wire protocol, with the password the container requires.
					// Deployed it is `rediss://` inside a VPC; the client is the
					// same either way.
					return `redis://:${encodeURIComponent(credential.containers.redis.password)}@${LOCAL_HOST}:${port}`;

				default:
					// The token in the userinfo, because an address and the credential
					// that opens it are one fact. Deployed the scheme is https and the
					// host is the provider's; nothing else differs.
					return `http://:${encodeURIComponent(credential.containers.cacheToken)}@${LOCAL_HOST}:${port}`;
			}

		case 'queue':
		case 'topic':
			return broker(plan, port, credential, resource);

		default:
			return undefined;
	}
}

/**
 * The producer's connection string, composed from the backend the plan chose.
 *
 * The protocol is what picks the transport, so a producer never branches: the
 * same `.publish()` reaches pg-boss here and SQS deployed because the string it
 * was handed said so.
 */
function broker(
	plan: Plan,
	port: number,
	credential: StageCredential,
	/** The topic or queue — needed where each is its own address (SNS/SQS). */
	resource?: PlannedResource,
): string {
	switch (plan.events) {
		case 'pgboss': {
			// A schema tenant of the database the app already declared, which is
			// why nothing here invents a Postgres of its own.
			const database = plan.resources.find((r) => r.kind === 'database');
			if (!database) throw new PgBossNeedsDatabase([]);

			const { user, password } = credential.containers.postgres;
			return `pgboss://${user}:${encodeURIComponent(password)}@${LOCAL_HOST}:${port}/${database.name}?schema=${PGBOSS_SCHEMA}`;
		}

		case 'rabbitmq': {
			// The exchange is declared by whichever client connects first, so
			// naming it here is the whole of the setup.
			const { user, password } = credential.containers.rabbitmq;
			return `rabbitmq://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${LOCAL_HOST}:${port}?exchange=${RABBITMQ_EXCHANGE}`;
		}

		case 'sns': {
			// The emulator's ARNs and queue URLs are deterministic, so the address
			// is composed here and the topic or queue is created beside it by the
			// applier (`applyCarriers`). Credentials ride in the string: the
			// emulator's are not the developer's AWS profile, and must not be
			// picked up from it.
			if (!resource) throw new UnprovisionedEventsBackend('sns');
			const endpoint = emulatorEndpoint(port);
			const address =
				resource.kind === 'topic'
					? snsUrl.build({
							topicArn: emulatorTopicArn(resource.name),
							region: EMULATOR_REGION,
							endpoint,
						})
					: sqsUrl.build({
							queueUrl: emulatorQueueUrl(resource.name, port),
							region: EMULATOR_REGION,
							endpoint,
						});
			const url = new URL(address);
			const { accessKeyId, secretAccessKey } = credential.containers.emulator;
			url.searchParams.set('accessKeyId', accessKeyId);
			url.searchParams.set('secretAccessKey', secretAccessKey);
			return url.toString();
		}
	}
}

/** A local Postgres URL, with the login it connects as. */
function postgres(
	port: number,
	database: string,
	credential: { user: string; password: string },
): string {
	return `postgres://${credential.user}:${encodeURIComponent(credential.password)}@${LOCAL_HOST}:${port}/${database}`;
}

/**
 * The role a handler connects as, for one database or tenant.
 *
 * The construct's id, lowercased and stage-scoped exactly as its database or
 * schema is — so `Orders` in the `test` stage connects as `orders_test`, and two
 * stages sharing one cluster cannot share a credential. Roles are cluster-scoped
 * in Postgres, which is why the suffix is not optional here the way it is for a
 * schema.
 */
export function localRole(resource: PlannedResource): string {
	return resource.name;
}

/**
 * The password for a derived local role.
 *
 * Derived rather than random, for the same reason the local secret is: a
 * password that changed on every `gkm dev` would lock a developer out of the
 * data they had a moment ago. Seeded by the project so two checkouts do not
 * share one, and by the stage so `test` and `development` do not.
 *
 * Without a seed it is a *local* credential by construction — the cluster is
 * on loopback and everything it is derived from is in the repo. `gkm compose`
 * serving a deployed stage passes that stage's random seed, which is what
 * makes the same derivation a secret.
 */
export function localRolePassword(
	project: string,
	plan: Plan,
	role: string,
	/**
	 * A deployed stage's random seed. Given, the derivation is the one a
	 * deploy makes — the seed first — so a stack serving that stage connects
	 * with the passwords its roles were created with.
	 */
	seed?: string,
): string {
	return createHash('sha256')
		.update(`${seed ? `${seed}:` : ''}${project}:${plan.stage}:role:${role}`)
		.digest('base64url')
		.slice(0, 32);
}

/**
 * A cache's address: its database's URL, carrying the table it reads.
 *
 * Appended rather than kept beside the URL as a second key, for the reason the
 * design gives everywhere else — an address and what it opens are one fact, and
 * two keys are one more thing to keep in step.
 */
function withTable(url: string, table: string): string {
	const parsed = new URL(url);
	parsed.searchParams.set('table', table);

	return parsed.toString();
}

/**
 * The physical database a derived resource lives in.
 *
 * Walks `of` to the top rather than reading the immediate parent, because a
 * reader's parent may itself be a schema tenant — two hops from the database
 * that actually exists.
 */
export function rootDatabase(resource: PlannedResource, plan: Plan): string {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	let current = resource;

	while (current.of) {
		const parent = byId.get(current.of);
		if (!parent) break;
		current = parent;
	}

	return current.name;
}

/** The schema a derived resource puts on its search path, if it has one. */
function schemaOf(resource: PlannedResource, plan: Plan): string | undefined {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	let current: PlannedResource | undefined = resource;

	// A reader has no schema of its own; it reads whatever its parent addresses.
	while (current) {
		if (current.kind === 'database-schema') return current.schema;
		current = current.of ? byId.get(current.of) : undefined;
	}

	return undefined;
}

/**
 * A broker address asked for without the topic or queue it would name.
 *
 * On SNS each topic and queue is its own address, so there is no project-wide
 * one to hand out — a cron's schedule store, say, cannot live there.
 */
export class UnprovisionedEventsBackend extends GkmError {
	constructor(readonly backend: string) {
		super(
			`'${backend}' has no single broker address: each topic and queue is ` +
				`addressed by its own ARN. Something asked for one without naming ` +
				`the topic or queue.`,
		);
		this.name = 'UnprovisionedEventsBackend';
	}
}

/**
 * The keyring an `Encryption` construct resolves to locally.
 *
 * Derived like a secret — stable across restarts, distinct per project, stage
 * and construct, never written to disk — so what `gkm dev` encrypted yesterday
 * still opens today. One key, because nothing local is worth rotating: a
 * server stage's keyring is generated and rotated in its secrets instead.
 */
function localKeyring(
	project: string,
	plan: Plan,
	resource: PlannedResource,
): string {
	const derive = (purpose: string) =>
		createHash('sha256')
			.update(`${project}:${plan.stage}:${resource.id}:${purpose}`)
			.digest();

	return formatKeyring({
		keys: [{ id: 'k1', key: derive('k1') }],
		index: derive('index'),
	});
}

/**
 * The value a secret resolves to locally.
 *
 * A hash of what identifies it, so it is stable, distinct per project, stage
 * and construct, and never written to disk as a literal. Deployed this is the
 * one kind whose value does *not* come from here — a secret manager generates
 * it once and the target reads it back.
 */
function localSecret(
	project: string,
	plan: Plan,
	resource: PlannedResource,
): string {
	return createHash('sha256')
		.update(`${project}:${plan.stage}:${resource.id}`)
		.digest('base64url')
		.slice(0, 43);
}
