import {
	DEFAULT_POSTGRES_VERSION,
	kebabCase,
	type PostgresVersion,
} from '@geekmidas/manifest';
/**
 * What gkm knows about each container it can derive.
 *
 * Everything provider-specific about the local target lives here: the image, the
 * ports the image listens on, and whether its data is worth keeping. The plan
 * says *which* containers exist and never says any of this, which is the split
 * the design asks for — neutral facts from the declaration, provider detail
 * from here and from config.
 *
 * Shared by allocation and by the compose writer so the two cannot disagree
 * about how many ports a container needs.
 */

/**
 * The Postgres image for a major version.
 *
 * One place that knows the tag shape, so a declared version reaches the
 * container without anyone restating `-alpine` beside it.
 */
export function postgresImage(version: PostgresVersion): string {
	return `postgres:${version}-alpine`;
}

/**
 * The default image for each container.
 *
 * Pinned to a major rather than `latest` where the image publishes one, so a
 * rebuild does not silently move a developer's Postgres a version. Overridable
 * per project: a project needing `postgis/postgis` says so in config.
 */
export const DEFAULT_IMAGES: Readonly<Record<string, string>> = {
	postgres: postgresImage(DEFAULT_POSTGRES_VERSION),
	minio: 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
	mailpit: 'axllent/mailpit:latest',
	redis: 'redis:8-alpine',
	'redis-http': 'hiett/serverless-redis-http:latest',
	rabbitmq: 'rabbitmq:4-management-alpine',
	// Pinned: 2.2.0 answers a KMS decrypt under the wrong encryption context
	// with UnknownError instead of InvalidCiphertextException.
	localstack: 'floci/floci:2.1.0',
	// The local edge: TLS with its own CA, and host-based routing onto the
	// bucket behind it. Not a CDN — what is missing locally is the *mapping*
	// and the certificate, not caching, and a caching proxy would add an
	// invalidation story no local stack needs.
	caddy: 'caddy:2-alpine',
};

/** One port an image listens on. */
export interface ContainerPort {
	/**
	 * The name this port is allocated and persisted under.
	 *
	 * Per port rather than per container so that adding a console port later
	 * assigns a new one instead of shifting the port the app already connects to.
	 */
	key: string;
	/** The port inside the container, fixed by the image. */
	inside: number;
	/** What it is for, in the one line `gkm dev` and `gkm setup` print. */
	label: string;
	/** A page a person opens, so it prints as a link rather than an address. */
	web?: true;
}

/**
 * The ports each container listens on.
 *
 * The first is always the one an app connects to; the rest are consoles and
 * management UIs, published because a bucket or an inbox you can look at is most
 * of why these are real containers rather than stubs.
 */
const PORTS: Readonly<Record<string, readonly ContainerPort[]>> = {
	postgres: [{ key: 'postgres', inside: 5432, label: 'postgres' }],
	minio: [
		{ key: 'minio', inside: 9000, label: 'minio api' },
		{ key: 'minio-console', inside: 9001, label: 'minio console', web: true },
	],
	mailpit: [
		{ key: 'mailpit', inside: 1025, label: 'smtp' },
		{ key: 'mailpit-web', inside: 8025, label: 'mailpit inbox', web: true },
	],
	redis: [{ key: 'redis', inside: 6379, label: 'redis' }],
	'redis-http': [{ key: 'redis-http', inside: 80, label: 'cache' }],
	rabbitmq: [
		{ key: 'rabbitmq', inside: 5672, label: 'amqp' },
		{
			key: 'rabbitmq-management',
			inside: 15672,
			label: 'rabbitmq console',
			web: true,
		},
	],
	localstack: [{ key: 'localstack', inside: 4566, label: 'localstack' }],
	// One port, and an assigned one rather than 443. The whole point of
	// allocation is that two projects run at once, and an edge that insists on
	// the privileged port puts that back — at the cost of a port in the URL,
	// which no cookie or CORS rule looks at.
	caddy: [{ key: 'caddy', inside: 443, label: 'https edge' }],
};

/**
 * An external API's fake, as the local target runs it.
 *
 * Keyed by its port key, `<id>-fake`, which is also its container's name when
 * it has one — so `primaryPortKey` finds its port with no table to consult.
 * A module fake has no image: gkm serves it, on the port this key is assigned.
 */
export interface PlannedFake {
	/** The external API it stands in for. */
	id: string;
	/** The image to run, for a fake the provider publishes. */
	image?: string;
	/** The port that image listens on inside the container. */
	port?: number;
}

/** The port key — and container name, for an image — of an API's fake. */
export function fakeKey(id: string): string {
	return `${kebabCase(id)}-fake`;
}

/**
 * The ports a container needs published. Empty for one gkm does not know.
 *
 * `fakes` answers for the containers no table can: an external API's fake
 * listens wherever its declaration says.
 */
export function portsOf(
	container: string,
	fakes: Readonly<Record<string, PlannedFake>> = {},
): readonly ContainerPort[] {
	const fake = fakes[container];
	if (fake?.port !== undefined) {
		return [{ key: container, inside: fake.port, label: `${fake.id} fake` }];
	}

	return PORTS[container] ?? [];
}

/** One published port, as a person reads it. */
export interface ServiceAddress {
	container: string;
	label: string;
	/** `http://localhost:<port>` for a page, `localhost:<port>` otherwise. */
	address: string;
}

/**
 * Every port the containers publish — not only the one an app connects to.
 *
 * The consoles and the inbox are most of why these are real containers, and an
 * inbox nobody can find is an inbox nobody opens: a sign-in link gets fished
 * out of `docker ps` instead.
 */
export function serviceAddresses(
	containers: readonly string[],
	ports: Readonly<Record<string, number>>,
	fakes: Readonly<Record<string, PlannedFake>> = {},
): ServiceAddress[] {
	return containers.flatMap((container) =>
		portsOf(container, fakes).flatMap((port) => {
			const assigned = ports[port.key];
			if (assigned === undefined) return [];
			return [
				{
					container,
					label: port.label,
					address: port.web
						? `http://localhost:${assigned}`
						: `localhost:${assigned}`,
				},
			];
		}),
	);
}

/** The lines `gkm dev` and `gkm setup` print under the services heading. */
export function describeServices(
	services: readonly ServiceAddress[],
): string[] {
	const width = Math.max(0, ...services.map(({ label }) => label.length));
	return services.map(
		({ label, address }) => `   ${label.padEnd(width)}  ${address}`,
	);
}

/** The key a container's primary port is allocated under. */
export function primaryPortKey(container: string): string {
	return portsOf(container)[0]?.key ?? container;
}

/**
 * Every port key a set of containers needs, in a stable order.
 *
 * What allocation is handed: it assigns ports to names and knows nothing about
 * what listens on them.
 */
export function portKeys(
	containers: readonly string[],
	fakes: Readonly<Record<string, PlannedFake>> = {},
): string[] {
	const keys = [...containers]
		.sort()
		.flatMap((container) => portsOf(container, fakes).map((port) => port.key));

	// A module fake runs in no container, and still needs a port to answer on.
	return [...new Set([...keys, ...Object.keys(fakes).sort()])];
}

/**
 * The named volume a container's data lives in.
 *
 * Mailpit deliberately has none: local mail is disposable, and an inbox that
 * survives days of dev is noise rather than state.
 */
export function volumeOf(container: string): string | undefined {
	const volumes: Readonly<Record<string, string>> = {
		postgres: 'postgres-data',
		minio: 'minio-data',
		redis: 'redis-data',
		rabbitmq: 'rabbitmq-data',
		localstack: 'localstack-data',
		// Holds the CA it generated. Losing it means a new root on every start,
		// and a trust store full of dead authorities.
		caddy: 'caddy-data',
	};

	return volumes[container];
}
