/**
 * The labels a construct answers on under a stage's domain.
 *
 * A surface or a site has one label it is called by — its `subdomain`, or its
 * id kebab-cased — and may name more: `aliases`, extra hosts it really answers
 * on, and (a site only) `redirects`, hosts that send a browser to the primary
 * one. Every consumer — the edge, DNS, certificates, CORS, the wildcard site's
 * protected labels — asks {@link hostLabels} rather than reading `subdomain`
 * and kebab-casing the id itself.
 *
 * The primary label stays canonical: `<ID>_URL`, a client's base URL and an
 * OpenAPI server are built on it alone. An alias adds hosts; it never changes
 * what a construct is called.
 */

import type {
	Declaration,
	RestApiDeclaration,
	SiteDeclaration,
	WebSocketApiDeclaration,
} from './declaration';
import { WILDCARD_SUBDOMAIN } from './declaration';
import { kebabCase } from './naming';

/** A declaration that answers on a host of its own. */
export type HostedDeclaration =
	| RestApiDeclaration
	| WebSocketApiDeclaration
	| SiteDeclaration;

/** What {@link hostLabels} reads: a declaration, or a construct's config before it is one. */
export interface HostLabelSource {
	id: string;
	subdomain?: string;
	aliases?: readonly string[];
	redirects?: readonly string[];
}

/** The labels one construct answers on, under a stage's domain. */
export interface HostLabels {
	/**
	 * What it is called: its `subdomain`, or its id kebab-cased. `'*'` for a
	 * wildcard site, whose hosts are whatever no other construct takes.
	 */
	primary: string;
	/** Other labels it answers on, exactly as on its primary one. */
	aliases: readonly string[];
	/** Labels that answer with a permanent redirect to its primary host. */
	redirects: readonly string[];
}

/** Whether a declaration answers on a host of its own: a surface or a site. */
export function isHostedDeclaration(
	declaration: Declaration | undefined,
): declaration is HostedDeclaration {
	return (
		declaration?.kind === 'rest-api' ||
		declaration?.kind === 'websocket-api' ||
		declaration?.kind === 'site'
	);
}

/**
 * The one derivation of a construct's labels: its primary label, its
 * aliases and its redirects, in declared order.
 */
export function hostLabels(source: HostLabelSource): HostLabels {
	return {
		primary: source.subdomain ?? kebabCase(source.id),
		aliases: [...(source.aliases ?? [])],
		redirects: [...(source.redirects ?? [])],
	};
}

/** One label of a DNS name: lowercase letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A `subdomain`, alias or redirect that cannot be a label of its own under
 * the domain.
 */
export class InvalidHostLabel extends Error {
	constructor(
		readonly id: string,
		readonly label: string,
		readonly field: 'aliases' | 'redirects' | 'subdomain',
	) {
		super(
			field === 'subdomain'
				? `'${id}' has subdomain: '${label}', which is not a host label: ` +
						`it is one lowercase label under the stage's domain ` +
						`('telemetry', 'logs') — letters, digits and inner hyphens, ` +
						`no '*' and no dots.`
				: `'${id}' lists '${label}' in ${field}, which is not a host label it ` +
						`can add: each entry is one lowercase label under the stage's ` +
						`domain ('rest', 'www') — no '*', no dots — listed once, and not ` +
						`the construct's own label. Fix or remove the entry.`,
		);
		this.name = 'InvalidHostLabel';
	}
}

/**
 * A construct's own `subdomain`, checked where it is constructed: one label,
 * never a wildcard — for a construct that cannot answer on every subdomain.
 *
 * @throws {InvalidHostLabel} for `'*'`, a dot, or anything not a DNS label
 */
export function assertSubdomainLabel(id: string, subdomain: string): void {
	if (!LABEL.test(subdomain)) {
		throw new InvalidHostLabel(id, subdomain, 'subdomain');
	}
}

/** A wildcard site with aliases or redirects. */
export class WildcardSiteCannotHaveAliases extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' answers on every subdomain, so it has no single host for an ` +
				`alias to repeat or a redirect to point at. Drop \`aliases\` and ` +
				`\`redirects\`, or give the site a subdomain of its own.`,
		);
		this.name = 'WildcardSiteCannotHaveAliases';
	}
}

/** One label listed as both an alias and a redirect. */
export class HostLabelBothAliasAndRedirect extends Error {
	constructor(
		readonly id: string,
		readonly label: string,
	) {
		super(
			`'${id}' lists '${label}' in both aliases and redirects, but a host ` +
				`either serves the site or sends the browser elsewhere. Keep it in ` +
				`one of the two.`,
		);
		this.name = 'HostLabelBothAliasAndRedirect';
	}
}

/**
 * What a construct's aliases and redirects have to be, checked where it is
 * constructed.
 *
 * @throws {WildcardSiteCannotHaveAliases} on a wildcard site with either
 * @throws {HostLabelBothAliasAndRedirect} when a label is in both lists
 * @throws {InvalidHostLabel} for `'*'`, a dot, a repeat, or its own label
 */
export function assertHostLabels(source: HostLabelSource): void {
	const { primary, aliases, redirects } = hostLabels(source);
	if (aliases.length === 0 && redirects.length === 0) return;
	if (primary === WILDCARD_SUBDOMAIN) {
		throw new WildcardSiteCannotHaveAliases(source.id);
	}

	for (const label of aliases) {
		if (redirects.includes(label)) {
			throw new HostLabelBothAliasAndRedirect(source.id, label);
		}
	}

	const seen = new Set<string>([primary]);
	const check = (labels: readonly string[], field: 'aliases' | 'redirects') => {
		for (const label of labels) {
			if (!LABEL.test(label) || seen.has(label)) {
				throw new InvalidHostLabel(source.id, label, field);
			}
			seen.add(label);
		}
	};
	check(aliases, 'aliases');
	check(redirects, 'redirects');
}
