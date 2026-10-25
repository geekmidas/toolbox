/**
 * A deployed stage's sites behind a password — `deploy.sitePassword` — so a
 * staging build is not public while it is being tried.
 *
 * The edge asks for it with HTTP basic auth, before a request reaches the
 * site: the browser prompts, and nothing of the site loads until the stage's
 * login is given. The user is the stage's name; the password is generated
 * once per site and kept in the stage's secrets, where one set by hand wins.
 * Only its bcrypt hash reaches the edge's config.
 *
 * Pure.
 */

import { createHash, randomBytes } from 'node:crypto';
import { type ConstructManifest, environmentCase } from '@geekmidas/manifest';
import bcrypt from 'bcryptjs';
import { GkmError } from '../errors';
import type { StageSecrets } from '../secrets/types.js';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** The basic-auth login a site is served behind. */
export interface SiteAuth {
	/** The stage's name. */
	user: string;
	password: string;
	/** The password's bcrypt hash — what the edge's config holds. */
	hash: string;
	/** The stage secret the password is kept in: `WEB_SITE_PASSWORD`. */
	key: string;
}

/** `deploy.sitePassword` names something that is not one of the stage's sites. */
export class UnknownPasswordSite extends GkmError {
	constructor(
		readonly stage: string,
		readonly site: string,
		readonly sites: readonly string[],
	) {
		super(
			`deploy.sitePassword.${stage} names '${site}', which is not a site of ` +
				`this workspace. ${
					sites.length > 0
						? `Its sites: ${sites.map((s) => `'${s}'`).join(', ')}.`
						: 'It declares no site.'
				} Name one of them, or set ${stage}: true for every site.`,
		);
		this.name = 'UnknownPasswordSite';
	}
}

/** A site the stage puts behind a password, with none in the stage's secrets. */
export class SitePasswordMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly key: string,
	) {
		super(
			`deploy.sitePassword puts a site of '${stage}' behind a password, and ` +
				`the stage has no ${key} in its secrets. Run gkm compose --stage ` +
				`${stage} once to generate it, or set one: ` +
				`gkm secrets:set ${key} '…' --stage ${stage}`,
		);
		this.name = 'SitePasswordMissing';
	}
}

/**
 * `deploy.sitePassword` names a stage that deploys through a target that
 * cannot ask for a login. Refused rather than ignored: ignored, the stage
 * would be public while its config says it is not.
 */
export class SitePasswordNeedsCompose extends GkmError {
	constructor(
		readonly stage: string,
		readonly target: string,
	) {
		super(
			`deploy.sitePassword puts '${stage}' behind a password, and it deploys ` +
				`through '${target}', which cannot ask for one yet — only compose ` +
				`does. Remove ${stage} from deploy.sitePassword, or deploy it with ` +
				`compose.`,
		);
		this.name = 'SitePasswordNeedsCompose';
	}
}

/**
 * @throws {SitePasswordNeedsCompose} where `stage` asks for a site password
 * and `target` is not compose
 */
export function assertSitePasswordTarget(
	workspace: Pick<NormalizedWorkspace, 'deploy'>,
	stage: string,
	target: string,
): void {
	if (workspace.deploy?.sitePassword?.[stage] && target !== 'compose') {
		throw new SitePasswordNeedsCompose(stage, target);
	}
}

/** The stage secret a site's password is kept in: `WEB_SITE_PASSWORD`. */
export function sitePasswordKey(site: string): string {
	return `${environmentCase(site)}_SITE_PASSWORD`;
}

/** Every site the manifest declares, by app name. */
export function siteNames(manifest: ConstructManifest): string[] {
	return Object.values(manifest)
		.filter((declaration) => declaration.kind === 'site')
		.map((declaration) => appKey(declaration.id));
}

/**
 * The sites `deploy.sitePassword` puts behind a password on `stage`, by app
 * name: every one for `true`, the ones it names otherwise.
 *
 * @throws {UnknownPasswordSite} for a name that is not one of `sites`
 */
export function passwordSites(
	workspace: Pick<NormalizedWorkspace, 'deploy'>,
	stage: string,
	sites: readonly string[],
): string[] {
	const choice = workspace.deploy?.sitePassword?.[stage];
	if (!choice) return [];
	if (choice === true) return [...sites];

	const chosen = new Set<string>();
	for (const name of choice) {
		const site = appKey(name);
		if (!sites.includes(site)) {
			throw new UnknownPasswordSite(stage, name, sites);
		}
		chosen.add(site);
	}
	return [...chosen];
}

/** A password: 192 random bits, URL-safe, so it is typed or pasted as is. */
export function generateSitePassword(): string {
	return randomBytes(24).toString('base64url');
}

/**
 * The stage's secrets with a generated password for each site, where it has
 * none. Pure, like `withGeneratedSecrets`: the caller keeps the result once
 * the run goes ahead.
 */
export function withSitePasswords(
	secrets: StageSecrets,
	sites: readonly string[],
): { secrets: StageSecrets; generated: string[] } {
	const missing = sites
		.map(sitePasswordKey)
		.filter((key) => !secrets.custom?.[key]);
	if (missing.length === 0) return { secrets, generated: [] };

	return {
		secrets: {
			...secrets,
			custom: {
				...secrets.custom,
				...Object.fromEntries(
					missing.map((key) => [key, generateSitePassword()]),
				),
			},
			updatedAt: new Date().toISOString(),
		},
		generated: missing,
	};
}

/**
 * The login a site is served behind on `stage`.
 *
 * The hash's salt is derived from the password, so the same password always
 * renders the same edge config: a deploy that changed nothing rewrites
 * nothing, and the proxy is not reloaded for it. A per-hash random salt
 * guards against a precomputed table of common passwords; a generated one is
 * 192 random bits, which no table holds.
 *
 * @throws {SitePasswordMissing} where the stage's secrets hold none
 */
export function siteAuth(
	stage: string,
	site: string,
	custom: Readonly<Record<string, string>>,
): SiteAuth {
	const key = sitePasswordKey(site);
	const password = custom[key];
	if (!password) throw new SitePasswordMissing(stage, key);

	return {
		user: stage,
		password,
		hash: bcrypt.hashSync(password, saltFor(password)),
		key,
	};
}

/** bcrypt's own base-64 alphabet, in which a salt is written. */
const BCRYPT_ALPHABET =
	'./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A bcrypt salt — `$2a$`, which Caddy and Traefik both read, at cost 10 —
 * derived from the password.
 */
function saltFor(password: string): string {
	const digest = createHash('sha256').update(password).digest();
	let salt = '';
	for (let i = 0; i < 22; i++) salt += BCRYPT_ALPHABET[digest[i]! % 64];
	return `$2a$10$${salt}`;
}
