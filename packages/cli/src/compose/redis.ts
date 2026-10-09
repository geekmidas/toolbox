/**
 * The stack's Redis: what every declared cache lives in when a workspace runs
 * as a `gkm compose` stack, on the local stage and on a deployed one alike.
 *
 * A cache is the one store whose contents can always be rebuilt, so unlike
 * Mailpit and MinIO it is a production service, not a dev stand-in: it runs
 * for every stage, on the compose network only, with nothing published. It
 * is bounded (`maxmemory`, evicting the least recently used key), persisted
 * (an append-only file on a named volume, kept by `--down`) and password
 * protected — the stage's own password, generated once like its seed.
 *
 * A stage that sets a cache's URL in its secrets — a managed Redis — keeps
 * it, and a stack whose every cache is set that way runs no Redis at all.
 *
 * Pure: the stack decides it, and the phases keep the password.
 */

import { randomBytes } from 'node:crypto';
import type { ConstructManifest } from '@geekmidas/manifest';
import { GkmError } from '../errors';
import { DEFAULT_IMAGES } from '../reconcile/containers.js';
import type { Plan } from '../reconcile/plan.js';
import type { StageSecrets } from '../secrets/types.js';
import type { CacheBackend } from '../types.js';
import type { StackService } from './stack.js';

/**
 * Where a stack's caches live: its own Redis, whatever the deploy target's
 * default is. A stack is one machine running containers, and a Redis beside
 * the apps is cheaper for a cache than a table in the database they share.
 */
export const STACK_CACHE: CacheBackend = 'redis';

/** Its compose service name — the host every cache URL points at. */
export const REDIS_SERVICE = 'redis';

/** The port it answers on, inside the network. */
export const REDIS_PORT = 6379;

/** Reconcile's pin, so `gkm dev` and the stack run one Redis. */
export const REDIS_IMAGE = DEFAULT_IMAGES.redis!;

/**
 * How much it may hold before it evicts. A cache that grows until the box
 * runs out of memory takes the apps with it; 256 MB is a lot of sessions and
 * little of a small server. A project's `docker-compose.<stage>.yml` can
 * replace the command to change it.
 */
export const REDIS_MAXMEMORY = '256mb';

/** The stage secret holding its password. */
export const REDIS_PASSWORD_KEY = 'REDIS_PASSWORD';

/** Redis's own count of logical databases, before `--databases` raises it. */
const REDIS_DATABASES = 16;

/** A deployed stage that runs the stack's Redis and has no password yet. */
export class RedisPasswordMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`The stage '${stage}' runs the stack's Redis and has no ` +
				`${REDIS_PASSWORD_KEY} in its secrets. Run gkm compose --stage ` +
				`${stage} without --dry-run once to generate it, or set one: ` +
				`gkm secrets:set ${REDIS_PASSWORD_KEY} '…' --stage ${stage}`,
		);
		this.name = 'RedisPasswordMissing';
	}
}

/** The stack's Redis, as the stack runs it. */
export interface StackRedis {
	password: string;
	/** Whether the stage's secrets set the password, rather than the local one. */
	passwordFromSecrets: boolean;
	/** Each cache it holds: its URL key, and the URL. */
	urls: Record<string, string>;
	/** Its own environment, written to `redis.env` (0600). */
	env: Record<string, string>;
	/** How many logical databases it keeps — one per cache, at least 16. */
	databases: number;
}

/**
 * Whether a stage's stack runs Redis: a cache is declared and the stage's
 * secrets do not set the URL of every one.
 */
export function runsRedis(
	manifest: ConstructManifest,
	custom: Readonly<Record<string, string>>,
): boolean {
	return Object.values(manifest).some(
		(declaration) =>
			declaration?.kind === 'cache' &&
			(declaration.provides ?? []).some((key) => custom[key] === undefined),
	);
}

/** A password: 256 random bits, URL-safe, so it sits in a URL unescaped. */
export function generateRedisPassword(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * The stage's secrets with a generated Redis password, where it has none.
 * Pure, like `withGeneratedSecrets`: the caller keeps the result once the run
 * goes ahead.
 */
export function withRedisPassword(secrets: StageSecrets): {
	secrets: StageSecrets;
	generated: string[];
} {
	if (secrets.custom?.[REDIS_PASSWORD_KEY]) return { secrets, generated: [] };
	return {
		secrets: {
			...secrets,
			custom: {
				...secrets.custom,
				[REDIS_PASSWORD_KEY]: generateRedisPassword(),
			},
			updatedAt: new Date().toISOString(),
		},
		generated: [REDIS_PASSWORD_KEY],
	};
}

/**
 * The stack's Redis for one stage, or nothing where no cache needs it.
 *
 * Each cache it holds gets a logical database of its own, by the order of
 * their ids, so two caches never read each other's keys.
 */
export function stackRedis(options: {
	plan: Plan;
	stage: string;
	local: boolean;
	custom: Readonly<Record<string, string>>;
	/** The local stage's generated password — `gkm dev`'s Redis's too. */
	localPassword?: string;
}): StackRedis | undefined {
	const { plan, stage, local, custom } = options;

	const caches = plan.resources
		.filter((r) => r.kind === 'cache' && custom[r.envKey] === undefined)
		.sort((a, b) => a.id.localeCompare(b.id));
	if (caches.length === 0) return undefined;

	const set = custom[REDIS_PASSWORD_KEY];
	const password = set ?? (local ? options.localPassword : undefined);
	if (!password) throw new RedisPasswordMissing(stage);
	const auth = encodeURIComponent(password);

	return {
		password,
		passwordFromSecrets: Boolean(set),
		urls: Object.fromEntries(
			caches.map((cache, index) => [
				cache.envKey,
				`redis://:${auth}@${REDIS_SERVICE}:${REDIS_PORT}/${index}`,
			]),
		),
		env: {
			// What the server is started with, by name: the command reads it
			// from the environment, so the value is never in its arguments.
			[REDIS_PASSWORD_KEY]: password,
			// What `redis-cli` signs in with — the health check's, and anyone's
			// who execs into the container — without `-a` on a command line.
			REDISCLI_AUTH: password,
		},
		databases: Math.max(REDIS_DATABASES, caches.length),
	};
}

/**
 * Redis's service: bounded, persisted and password protected, on the
 * network alone.
 *
 * The command runs the image's own entrypoint with `redis-server` first, so
 * it still drops to the `redis` user and owns `/data`; the password is read
 * from the env file by the shell (`$$` is compose's escape for `$`), so
 * neither the compose file nor the container's command holds it.
 */
export function redisService(redis: StackRedis): StackService {
	const flags = [
		`--requirepass "$$${REDIS_PASSWORD_KEY}"`,
		`--maxmemory ${REDIS_MAXMEMORY}`,
		'--maxmemory-policy allkeys-lru',
		'--appendonly yes',
		...(redis.databases > REDIS_DATABASES
			? [`--databases ${redis.databases}`]
			: []),
	];
	return {
		image: REDIS_IMAGE,
		restart: 'unless-stopped',
		command: [
			'sh',
			'-c',
			`exec docker-entrypoint.sh redis-server ${flags.join(' ')}`,
		],
		env_file: [{ path: `./${REDIS_SERVICE}.env`, format: 'raw' }],
		volumes: ['redis-data:/data'],
		healthcheck: {
			// `redis-cli` signs in with REDISCLI_AUTH; an unauthenticated ping
			// answers NOAUTH, which is not PONG.
			test: ['CMD-SHELL', 'redis-cli ping | grep -q PONG'],
			interval: '5s',
			timeout: '3s',
			retries: 10,
		},
	};
}
