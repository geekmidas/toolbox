/**
 * Which proxy a stage's stack is served by, and with whose certificate —
 * `deploy.compose.proxy` and `deploy.compose.tls`, resolved for one stage.
 *
 * Pure, and kept apart from the stack so the workspace schema can check a
 * config with the same rules — and the same named errors — the stack applies.
 */

import { isAbsolute, resolve } from 'node:path';
import { GkmError } from '../errors';
import type {
	ComposeProxy,
	ComposeTlsConfig,
	ComposeWorkspaceConfig,
} from '../workspace/types.js';

/** A per-stage setting keyed by a stage the workspace does not have. */
export class ComposeStageUnknown extends GkmError {
	constructor(
		readonly setting: 'proxy' | 'tls' | 'server',
		readonly stage: string,
		readonly stages: readonly string[],
	) {
		super(
			`deploy.compose.${setting} names the stage '${stage}', which is not one ` +
				`of this workspace's (${stages.join(', ')}). Use a stage from ` +
				'stages.local or stages.deployed.',
		);
		this.name = 'ComposeStageUnknown';
	}
}

/**
 * A certificate for the local stage, whose certificates are always Caddy's
 * own CA — the one `gkm trust` installs.
 */
export class ComposeTlsOnLocalStage extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.compose.tls sets a certificate for '${stage}', the local stage, ` +
				"whose certificates always come from Caddy's local CA (`gkm trust` " +
				'installs it). Remove it, or set it for a deployed stage.',
		);
		this.name = 'ComposeTlsOnLocalStage';
	}
}

/**
 * A server for the local stage, which always runs on this machine's Docker.
 */
export class ComposeServerOnLocalStage extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.compose.server names '${stage}', the local stage, which always ` +
				"runs on this machine's Docker. Remove it, or set it for a deployed stage.",
		);
		this.name = 'ComposeServerOnLocalStage';
	}
}

/** The stage's certificate or key file is not there to read. */
export class ComposeTlsFileMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly file: string,
	) {
		super(
			`deploy.compose.tls for '${stage}' names ${file}, and there is no file ` +
				'there. Point certFile and keyFile at the PEM certificate (with its ' +
				'chain) and key — relative to the workspace root, or absolute.',
		);
		this.name = 'ComposeTlsFileMissing';
	}
}

/**
 * The proxy a stage's stack is served by. The local stage is always Caddy —
 * its internal CA and `gkm trust` — whatever is configured.
 */
export function proxyFor(
	config: ComposeWorkspaceConfig | undefined,
	stage: string,
	local: boolean,
): ComposeProxy {
	if (local) return 'caddy';
	const proxy = config?.proxy;
	if (!proxy) return 'caddy';
	if (typeof proxy === 'string') return proxy;
	return proxy[stage] ?? 'caddy';
}

/** A deployed stage's own certificate, its paths absolute, when it sets one. */
export function certificateFor(
	config: ComposeWorkspaceConfig | undefined,
	stage: string,
	root: string,
): ComposeTlsConfig | undefined {
	const tls = config?.tls?.[stage];
	if (!tls) return undefined;
	const absolute = (file: string) =>
		isAbsolute(file) ? file : resolve(root, file);
	return { certFile: absolute(tls.certFile), keyFile: absolute(tls.keyFile) };
}

/**
 * Throws the named error for the first thing wrong with the per-stage
 * settings: a stage the workspace does not have, or a certificate for the
 * local stage.
 */
export function checkComposeStages(
	config: ComposeWorkspaceConfig | undefined,
	stages: { local: string; deployed: readonly string[] },
): void {
	const known = [stages.local, ...stages.deployed];
	if (config?.proxy && typeof config.proxy === 'object') {
		for (const stage of Object.keys(config.proxy)) {
			if (!known.includes(stage)) {
				throw new ComposeStageUnknown('proxy', stage, known);
			}
		}
	}
	for (const stage of Object.keys(config?.tls ?? {})) {
		if (stage === stages.local) throw new ComposeTlsOnLocalStage(stage);
		if (!known.includes(stage)) {
			throw new ComposeStageUnknown('tls', stage, known);
		}
	}
	for (const stage of Object.keys(config?.server ?? {})) {
		if (stage === stages.local) throw new ComposeServerOnLocalStage(stage);
		if (!known.includes(stage)) {
			throw new ComposeStageUnknown('server', stage, known);
		}
	}
}
