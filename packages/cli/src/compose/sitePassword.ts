/**
 * A site served behind a password on some deployed stages — a `StaticSite`'s
 * `password`, naming a `RandomPassword` — so a staging build is not public
 * while it is being tried.
 *
 * The edge asks for it with HTTP basic auth, before a request reaches the
 * site: the browser prompts, and nothing of the site loads until the stage's
 * login is given. The user is the stage's name; the password is the
 * `RandomPassword`'s value on the stage, generated and kept like any other.
 * Only its bcrypt hash reaches the edge's config.
 *
 * Pure.
 */

import { createHash } from 'node:crypto';
import type { ConstructManifest, SiteDeclaration } from '@geekmidas/manifest';
import bcrypt from 'bcryptjs';
import { GkmError } from '../errors';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** The basic-auth login a site is served behind. */
export interface SiteAuth {
	/** The stage's name. */
	user: string;
	password: string;
	/** The password's bcrypt hash — what the edge's config holds. */
	hash: string;
	/** The stage secret the password is kept in: `SITE_PASSWORD`. */
	key: string;
}

/** A site's `password` names a `RandomPassword` the manifest does not hold. */
export class SitePasswordNotDeclared extends GkmError {
	constructor(
		readonly site: string,
		readonly secret: string,
	) {
		super(
			`'${site}' is served behind the password '${secret}', and no ` +
				`RandomPassword '${secret}' was found. Export it from a constructs ` +
				`file, as any construct is: export const ${secret[0]!.toLowerCase()}${secret.slice(1)} = ` +
				`new RandomPassword('${secret}');`,
		);
		this.name = 'SitePasswordNotDeclared';
	}
}

/** A site's `password` names a stage the workspace does not deploy. */
export class UnknownPasswordStage extends GkmError {
	constructor(
		readonly site: string,
		readonly stage: string,
		readonly deployed: readonly string[],
	) {
		super(
			`'${site}' is served behind a password on '${stage}', which is not ` +
				`one of the workspace's deployed stages (${deployed
					.map((s) => `'${s}'`)
					.join(', ')}). Name one of them in its password's stages.`,
		);
		this.name = 'UnknownPasswordStage';
	}
}

/** A site behind a password, with none in the stage's secrets. */
export class SitePasswordMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly key: string,
	) {
		super(
			`A site of '${stage}' is served behind a password, and the stage has ` +
				`no ${key} in its secrets. Run gkm compose --stage ${stage} once to ` +
				`generate it, or set one: gkm secrets:set ${key} '…' --stage ${stage}`,
		);
		this.name = 'SitePasswordMissing';
	}
}

/**
 * A site behind a password on a stage it deploys through a target that cannot
 * ask for a login. Refused rather than ignored: ignored, the site would be
 * public while its construct says it is not.
 */
export class SitePasswordNeedsCompose extends GkmError {
	constructor(
		readonly site: string,
		readonly stage: string,
		readonly target: string,
	) {
		super(
			`'${site}' is served behind a password on '${stage}', and it deploys ` +
				`through '${target}', which cannot ask for one yet — only compose ` +
				`does. Remove ${stage} from its password's stages, or deploy it ` +
				`with compose.`,
		);
		this.name = 'SitePasswordNeedsCompose';
	}
}

/**
 * The `RandomPassword` a site is served behind on `stage`, by its key —
 * `SITE_PASSWORD` — or `undefined` where the stage asks for none.
 *
 * @throws {SitePasswordNotDeclared} where the password is not in the manifest
 */
export function sitePasswordKey(
	manifest: ConstructManifest,
	site: SiteDeclaration,
	stage: string,
): string | undefined {
	const password = site.password;
	if (!password?.stages.includes(stage)) return undefined;

	const secret = manifest[password.secret];
	const key = secret?.kind === 'secret' ? secret.provides?.[0] : undefined;
	if (!key) throw new SitePasswordNotDeclared(site.id, password.secret);
	return key;
}

/**
 * Before anything is deployed: every site behind a password names a deployed
 * stage and a declared `RandomPassword`, and one of `apps` behind it on
 * `stage` deploys through compose.
 *
 * @throws {UnknownPasswordStage}, {SitePasswordNotDeclared},
 * {SitePasswordNeedsCompose}
 */
export function assertSitePasswords(
	workspace: Pick<NormalizedWorkspace, 'stages'>,
	manifest: ConstructManifest,
	stage: string,
	apps: readonly string[],
	target: string,
): void {
	for (const site of Object.values(manifest)) {
		if (site.kind !== 'site' || !site.password) continue;

		for (const named of site.password.stages) {
			if (!workspace.stages.deployed.includes(named)) {
				throw new UnknownPasswordStage(
					site.id,
					named,
					workspace.stages.deployed,
				);
			}
		}

		const key = sitePasswordKey(manifest, site, stage);
		if (key && target !== 'compose' && apps.includes(appKey(site.id))) {
			throw new SitePasswordNeedsCompose(site.id, stage, target);
		}
	}
}

/**
 * The login a site is served behind on `stage`, from the password kept under
 * `key`.
 *
 * The hash's salt is derived from the password, so the same password always
 * renders the same edge config: a deploy that changed nothing rewrites
 * nothing, and the proxy is not reloaded for it. A per-hash random salt
 * guards against a precomputed table of common passwords; a generated one is
 * 43 random characters, which no table holds.
 *
 * @throws {SitePasswordMissing} where the stage's secrets hold none
 */
export function siteAuth(
	stage: string,
	key: string,
	custom: Readonly<Record<string, string>>,
): SiteAuth {
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
