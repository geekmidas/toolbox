/**
 * The self-hosted telemetry provider's options, read: how the stack's
 * OpenObserve is run and reached — `deploy.telemetry.<stage>` with
 * `provider: 'self-hosted'`.
 *
 * Kept apart from the stack so the workspace schema can check a config with
 * the same rules — and the same named errors — the stack applies.
 */

import { isIP } from 'node:net';
import type { SelfHostedTelemetryConfig } from '../workspace/types.js';

/** The port OpenObserve listens on, and the one it is published on by default. */
export const LOGS_PORT = 5080;

/** How many days of data OpenObserve keeps unless told otherwise. */
export const LOGS_RETENTION_DAYS = 30;

/** The fewest days OpenObserve accepts: below it, it refuses to start. */
export const LOGS_MIN_RETENTION_DAYS = 3;

/** The self-hosted provider's options, with their defaults applied. */
export interface ResolvedLogs {
	/** The loopback port it is published on. Not published when `public` is set. */
	port: number;
	retentionDays: number;
	/** Served on `logs.<stage domain>`, to these addresses only. */
	public?: { allow: string[] };
}

/** `public` with no address to allow: nobody could reach it. */
export class LogsAllowEmpty extends Error {
	constructor(readonly stage: string) {
		super(
			`deploy.telemetry.${stage}.public.allow is empty, so the logs site would ` +
				'answer every request with 403. List the addresses that may reach it ' +
				"(public: { allow: ['203.0.113.7', '10.0.0.0/8'] }), or remove public " +
				'and reach it through an SSH tunnel.',
		);
		this.name = 'LogsAllowEmpty';
	}
}

/** An `allow` entry that is not an IP address or a CIDR range. */
export class LogsAllowEntryInvalid extends Error {
	constructor(
		readonly stage: string,
		readonly entry: string,
	) {
		super(
			`deploy.telemetry.${stage}.public.allow has '${entry}', which is not an IP ` +
				"address or a CIDR range. Write one like '203.0.113.7', " +
				"'10.0.0.0/8' or '2001:db8::/32'.",
		);
		this.name = 'LogsAllowEntryInvalid';
	}
}

/** A retention OpenObserve would refuse to start with. */
export class LogsRetentionInvalid extends Error {
	constructor(
		readonly stage: string,
		readonly retentionDays: unknown,
	) {
		super(
			`deploy.telemetry.${stage}.retentionDays is ${String(retentionDays)}; it must ` +
				`be a whole number of days, at least ${LOGS_MIN_RETENTION_DAYS} — ` +
				'OpenObserve refuses to start with fewer. Leave it out for ' +
				`${LOGS_RETENTION_DAYS}.`,
		);
		this.name = 'LogsRetentionInvalid';
	}
}

/** A port that is not one. */
export class LogsPortInvalid extends Error {
	constructor(
		readonly stage: string,
		readonly port: unknown,
	) {
		super(
			`deploy.telemetry.${stage}.port is ${String(port)}; set it to a number ` +
				`between 1 and 65535, or leave it out for ${LOGS_PORT}.`,
		);
		this.name = 'LogsPortInvalid';
	}
}

/** Whether `entry` is an IP address, or an address and a prefix length. */
function isAddressOrRange(entry: string): boolean {
	const [address = '', prefix, ...rest] = entry.split('/');
	if (rest.length > 0) return false;
	const family = isIP(address);
	if (family === 0) return false;
	if (prefix === undefined) return true;
	if (!/^\d{1,3}$/.test(prefix)) return false;
	return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * The self-hosted provider's options with their defaults — `{}` for all of
 * them. Throws the named error for the first thing wrong with them.
 */
export function resolveSelfHosted(
	config: Omit<SelfHostedTelemetryConfig, 'provider' | 'sampleRate'>,
	stage: string,
): ResolvedLogs {
	const port = config.port ?? LOGS_PORT;
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new LogsPortInvalid(stage, config.port);
	}

	const retentionDays = config.retentionDays ?? LOGS_RETENTION_DAYS;
	if (
		!Number.isInteger(retentionDays) ||
		retentionDays < LOGS_MIN_RETENTION_DAYS
	) {
		throw new LogsRetentionInvalid(stage, config.retentionDays);
	}

	if (config.public) {
		const allow = config.public.allow ?? [];
		if (allow.length === 0) throw new LogsAllowEmpty(stage);
		for (const entry of allow) {
			if (!isAddressOrRange(entry))
				throw new LogsAllowEntryInvalid(stage, entry);
		}
		return { port, retentionDays, public: { allow: [...allow] } };
	}

	return { port, retentionDays };
}
