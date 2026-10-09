/**
 * The stack's log UI: OpenObserve, run beside the apps as telemetry's
 * self-hosted provider, and every process with a `Telemetry` edge pointed at
 * it.
 *
 * The production server already exports its traces and pino logs over
 * OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. OpenObserve takes OTLP
 * at `/api/<org>/v1/{logs,traces}` with HTTP basic auth, so wiring an app is
 * two variables: the endpoint, `http://openobserve:5080/api/default`, and
 * the header that signs in as the root user.
 *
 * It is reached, by default, through an SSH tunnel: published on 127.0.0.1
 * only, because a port Docker publishes on every interface is opened in the
 * firewall by Docker itself, past ufw's rules. Served publicly, it is a host
 * on the stack's Caddy that refuses every address not allowed.
 *
 * Pure: the stack decides it, and the phases print and check it.
 */

import { randomBytes } from 'node:crypto';
import { GkmError } from '../errors';
import type { StageSecrets } from '../secrets/types.js';
import { NoDomainForStage } from '../target/dokploy/domain.js';
import { LOGS_PORT, type ResolvedLogs } from './logsConfig.js';
import type { StackService } from './stack.js';

/**
 * The image, pinned. A log store's on-disk format is the thing that must not
 * move under a running stack, so a new version is a change to this line.
 */
export const OPENOBSERVE_IMAGE = 'public.ecr.aws/zinclabs/openobserve:v1.0.4';

/** Its compose service name — the host the apps send to. */
export const LOGS_SERVICE = 'openobserve';

/** The organisation every app's telemetry lands in. */
export const LOGS_ORG = 'default';

/** The stage secrets that sign in as OpenObserve's root user. */
export const LOGS_EMAIL_KEY = 'ZO_ROOT_USER_EMAIL';
export const LOGS_PASSWORD_KEY = 'ZO_ROOT_USER_PASSWORD';

/**
 * The local stage's root user. Its password is generated per machine with
 * the other local logins — see `reconcile/localCredentials.ts`.
 */
export const LOCAL_LOGS_EMAIL = 'admin@gkm.localhost';

/** The stack's OpenObserve, as the stack runs it. */
export interface StackLogs extends ResolvedLogs {
	/** The root user's email and password. */
	email: string;
	password: string;
	/** Whether the stage's secrets set the password, rather than the local login. */
	passwordFromSecrets: boolean;
	/** Where a browser opens it: the tunnel's end, or its public host. */
	url: string;
	/** Its public host, when it is served through Caddy. */
	host?: string;
	/** Its own environment, written to `openobserve.env` (0600). */
	env: Record<string, string>;
	/** Where every process with a `Telemetry` edge sends, and how it signs. */
	appEnv: {
		OTEL_EXPORTER_OTLP_ENDPOINT: string;
		OTEL_EXPORTER_OTLP_HEADERS: string;
	};
}

/** A root password OpenObserve would refuse to start with. */
export class LogsPasswordWeak extends GkmError {
	constructor(readonly stage: string) {
		super(
			`The stage '${stage}' sets ${LOGS_PASSWORD_KEY}, and OpenObserve refuses ` +
				'it: a root password must be 8 to 128 characters with a lowercase ' +
				'letter, an uppercase letter, a digit and a symbol. Set another with ' +
				`gkm secrets:set ${LOGS_PASSWORD_KEY} '…' --stage ${stage}, or unset ` +
				'it to have one generated.',
		);
		this.name = 'LogsPasswordWeak';
	}
}

/** A deployed stage with logs on and no root password generated yet. */
export class LogsPasswordMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`The stage '${stage}' runs OpenObserve and has no ${LOGS_PASSWORD_KEY} ` +
				`in its secrets. Run gkm compose --stage ${stage} without --dry-run ` +
				'once to generate it, or set one: ' +
				`gkm secrets:set ${LOGS_PASSWORD_KEY} '…' --stage ${stage}`,
		);
		this.name = 'LogsPasswordMissing';
	}
}

/** Whether OpenObserve accepts `password` for its root user. */
export function isStrongLogsPassword(password: string): boolean {
	return (
		password.length >= 8 &&
		password.length <= 128 &&
		/[a-z]/.test(password) &&
		/[A-Z]/.test(password) &&
		/\d/.test(password) &&
		/[^A-Za-z0-9]/.test(password)
	);
}

/**
 * A root password: 192 random bits, with a fixed tail so every class
 * OpenObserve requires is present whatever the random part drew.
 */
export function generateLogsPassword(): string {
	return `${randomBytes(24).toString('base64url')}-Zo1`;
}

/**
 * The stage's secrets with a generated root password, where it has none.
 * Pure, like `withGeneratedSecrets`: the caller keeps the result once the
 * run goes ahead.
 */
export function withLogsPassword(secrets: StageSecrets): {
	secrets: StageSecrets;
	generated: string[];
} {
	if (secrets.custom?.[LOGS_PASSWORD_KEY]) return { secrets, generated: [] };
	return {
		secrets: {
			...secrets,
			custom: {
				...secrets.custom,
				[LOGS_PASSWORD_KEY]: generateLogsPassword(),
			},
			updatedAt: new Date().toISOString(),
		},
		generated: [LOGS_PASSWORD_KEY],
	};
}

/**
 * `OTEL_EXPORTER_OTLP_HEADERS` signing in as `email`.
 *
 * The variable's values are percent-decoded by the SDK (they follow the W3C
 * baggage format), so the space after `Basic` is written `%20`. Base64's own
 * `+`, `/` and `=` pass through decoding unchanged.
 */
export function otlpHeaders(email: string, password: string): string {
	const token = Buffer.from(`${email}:${password}`).toString('base64');
	return `Authorization=Basic%20${token}`;
}

/** The stack's OpenObserve for one stage. */
export function stackLogs(options: {
	config: ResolvedLogs;
	stage: string;
	local: boolean;
	/** The workspace's name: the local stage's public host is under it. */
	project: string;
	domain?: string;
	custom: Readonly<Record<string, string>>;
	/** The edge's HTTPS port, which a local public URL carries. */
	https: number;
	/** The local stage's generated root login — required for it. */
	localLogin?: { email: string; password: string };
}): StackLogs {
	const { config, stage, local, custom } = options;

	if (!local && !options.domain) throw new NoDomainForStage(stage);

	const email =
		custom[LOGS_EMAIL_KEY] ??
		(local
			? (options.localLogin?.email ?? LOCAL_LOGS_EMAIL)
			: `admin@${options.domain}`);
	const set = custom[LOGS_PASSWORD_KEY];
	const password = set ?? (local ? options.localLogin?.password : undefined);
	if (!password) throw new LogsPasswordMissing(stage);
	if (!isStrongLogsPassword(password)) throw new LogsPasswordWeak(stage);

	const host = config.public
		? local
			? `logs.${options.project}.localhost`
			: `logs.${options.domain}`
		: undefined;
	const url = host
		? `https://${host}${local && options.https !== 443 ? `:${options.https}` : ''}`
		: `http://localhost:${config.port}`;

	return {
		...config,
		email,
		password,
		passwordFromSecrets: Boolean(set),
		url,
		...(host ? { host } : {}),
		env: {
			[LOGS_EMAIL_KEY]: email,
			[LOGS_PASSWORD_KEY]: password,
			ZO_DATA_DIR: '/data',
			// Verified against the image: days, and it refuses fewer than 3.
			ZO_COMPACT_DATA_RETENTION_DAYS: String(config.retentionDays),
			// A self-hosted log store on a stage's box does not report home.
			ZO_TELEMETRY: 'false',
		},
		appEnv: {
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://${LOGS_SERVICE}:${LOGS_PORT}/api/${LOGS_ORG}`,
			OTEL_EXPORTER_OTLP_HEADERS: otlpHeaders(email, password),
		},
	};
}

/**
 * OpenObserve's service. The image has no shell, `wget` or `curl`, so its
 * health check is its own binary asking the running server for its status —
 * which exits non-zero when nothing answers on its port.
 */
export function logsService(logs: StackLogs): StackService {
	return {
		image: OPENOBSERVE_IMAGE,
		restart: 'unless-stopped',
		env_file: [{ path: `./${LOGS_SERVICE}.env`, format: 'raw' }],
		volumes: ['openobserve-data:/data'],
		// Loopback only: Docker opens a port it publishes on every interface in
		// the firewall itself, past ufw. Served publicly, Caddy is the way in.
		...(logs.public ? {} : { ports: [`127.0.0.1:${logs.port}:${LOGS_PORT}`] }),
		healthcheck: {
			test: ['CMD', '/openobserve', 'node', 'status'],
			interval: '10s',
			timeout: '5s',
			retries: 12,
			start_period: '20s',
		},
	};
}

/** Where to guess the stack is reached from, for the printed tunnel. */
export interface LogsAccessContext {
	stage: string;
	local: boolean;
	/** This machine's user and name — the best guess at the SSH target. */
	user: string;
	hostname: string;
}

/** What `gkm compose` prints once the stack is up: how to open the logs. */
export function logsAccess(logs: StackLogs, ctx: LogsAccessContext): string[] {
	const login = `login: ${logs.email}, password: ${
		ctx.local && !logs.passwordFromSecrets
			? logs.password
			: `gkm secrets:show --stage ${ctx.stage} --reveal → ${LOGS_PASSWORD_KEY}`
	}`;

	if (logs.public) {
		return [
			`📜 Logs (OpenObserve): ${logs.url}  (${login})`,
			`     answered only for ${logs.public.allow.join(', ')}; every other address gets 403`,
		];
	}

	return [
		`📜 Logs (OpenObserve) on 127.0.0.1:${logs.port} — from your computer:`,
		// The local stage usually runs where you are; it can run on a box too.
		...(ctx.local
			? [
					`     on this machine, open http://localhost:${logs.port} directly; from another:`,
				]
			: []),
		`     ssh -N -L ${logs.port}:localhost:${logs.port} ${ctx.user}@${ctx.hostname}   (user and host are guesses: this machine's)`,
		`     then open http://localhost:${logs.port}  (${login})`,
		`⚠️  Docker-published ports bypass ufw, so OpenObserve is bound to 127.0.0.1 only — reach it through the tunnel, not by opening the port.`,
	];
}
