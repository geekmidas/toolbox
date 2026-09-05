import {
	DEFAULT_POSTGRES_VERSION,
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
	minio: 'minio/minio:latest',
	mailpit: 'axllent/mailpit:latest',
	redis: 'redis:8-alpine',
	'redis-http': 'hiett/serverless-redis-http:latest',
	rabbitmq: 'rabbitmq:4-management-alpine',
	localstack: 'floci/floci:latest',
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
	/** What it is for, in the one line `gkm status` prints. */
	label: string;
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
		{ key: 'minio-console', inside: 9001, label: 'minio console' },
	],
	mailpit: [
		{ key: 'mailpit', inside: 1025, label: 'smtp' },
		{ key: 'mailpit-web', inside: 8025, label: 'mailpit inbox' },
	],
	redis: [{ key: 'redis', inside: 6379, label: 'redis' }],
	'redis-http': [{ key: 'redis-http', inside: 80, label: 'cache' }],
	rabbitmq: [
		{ key: 'rabbitmq', inside: 5672, label: 'amqp' },
		{ key: 'rabbitmq-management', inside: 15672, label: 'rabbitmq console' },
	],
	localstack: [{ key: 'localstack', inside: 4566, label: 'localstack' }],
	// One port, and an assigned one rather than 443. The whole point of
	// allocation is that two projects run at once, and an edge that insists on
	// the privileged port puts that back — at the cost of a port in the URL,
	// which no cookie or CORS rule looks at.
	caddy: [{ key: 'caddy', inside: 443, label: 'https edge' }],
};

/** The ports a container needs published. Empty for one gkm does not know. */
export function portsOf(container: string): readonly ContainerPort[] {
	return PORTS[container] ?? [];
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
export function portKeys(containers: readonly string[]): string[] {
	return [...containers]
		.sort()
		.flatMap((container) => portsOf(container).map((port) => port.key));
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
