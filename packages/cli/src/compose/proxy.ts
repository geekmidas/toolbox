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
				'chain) and key, and caFile at the root it chains to where you set ' +
				'one — relative to the workspace root, or absolute.',
		);
		this.name = 'ComposeTlsFileMissing';
	}
}

/**
 * The proxy a stage's stack is served by: Caddy unless `deploy.compose.proxy`
 * says otherwise. The plain string form is every stage's, the local one
 * included — a deployed stage behind its server's shared edge, the local one
 * behind a Traefik edge on this machine. The per-stage map sets each stage it
 * names, and a stage it leaves out is on Caddy: it is how one stage runs
 * something else (`proxy: { development: 'caddy', production: 'traefik' }`).
 *
 * The one place a stage's proxy is decided: `gkm compose` reads it for the
 * stage it runs, and `gkm dev` and `gkm test` for the local stage
 * (`localEdgeFor`).
 */
export function proxyFor(
	config: ComposeWorkspaceConfig | undefined,
	stage: string,
): ComposeProxy {
	const proxy = config?.proxy;
	if (!proxy) return 'caddy';
	if (typeof proxy === 'string') return proxy;
	return proxy[stage] ?? 'caddy';
}

/**
 * A stage's own certificate, its paths absolute, when it sets one — any
 * stage's, the local one's included, served by either proxy.
 */
export function certificateFor(
	config: ComposeWorkspaceConfig | undefined,
	stage: string,
	root: string,
): ComposeTlsConfig | undefined {
	const tls = config?.tls?.[stage];
	if (!tls) return undefined;
	const absolute = (file: string) =>
		isAbsolute(file) ? file : resolve(root, file);
	return {
		certFile: absolute(tls.certFile),
		keyFile: absolute(tls.keyFile),
		...(tls.caFile ? { caFile: absolute(tls.caFile) } : {}),
	};
}

/**
 * Throws the named error for the first thing wrong with the per-stage
 * settings: a stage the workspace does not have, or a server for the local
 * stage.
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
