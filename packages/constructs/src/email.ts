/**
 * `Email` — declared outbound mail.
 *
 * The same three-package meeting point as `ObjectStorage`: it implements the
 * construct contract, derives its env key through `@geekmidas/manifest`, and
 * hands back an `@geekmidas/emailkit` client. It names no provider — locally the
 * injected URL points at Mailpit, deployed it points at SES or whichever service
 * config selected.
 *
 * Where object storage needs a driver per provider, this needs none: mail is
 * delivered over SMTP whoever delivers it, so there is one client and one URL
 * shape, and the provider survives only as a host and a credential.
 */

import type { EmailClient, TemplateRecord } from '@geekmidas/emailkit';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	providedKeyFor,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';
import { loadEmailkit } from './optionalPeers';

export interface EmailOptions<TTemplates extends TemplateRecord> {
	/**
	 * The React templates this app can send.
	 *
	 * Structural — they are code, they ship with the handler, and which ones
	 * exist cannot differ between stages. They are also what types
	 * `sendTemplate`, so passing them here is what makes the client's call sites
	 * checkable.
	 */
	templates: TTemplates;
	/**
	 * The local part mail is sent from — `'info'` sends as `info@` the stage's
	 * domain (`info@localhost` under `gkm dev`). Defaults to `noreply`.
	 *
	 * Only the local part: it is structural, the same on every stage, and the
	 * templates' copy is written for it. The domain is the stage's, so a stage
	 * whose domain changes sends from the new one. A whole address for one
	 * stage is `deploy.email.<stage>.from`, which wins over this.
	 */
	from?: string;
	/** A reply-to address for every send. */
	replyTo?: string;
}

/**
 * The address-shaped characters a local part may hold: the dot-atom of RFC
 * 5322, which is every sender anyone sends from.
 */
const LOCAL_PART =
	/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/** An `Email`'s `from` that is not a bare local part. */
export class EmailFromNotALocalPart extends Error {
	constructor(
		readonly id: string,
		readonly from: string,
	) {
		super(
			from.includes('@')
				? `Email '${id}' has from: '${from}', a whole address. 'from' is the local part only — from: '${from.slice(0, from.lastIndexOf('@'))}' sends as that @ the stage's domain. A whole address for one stage is deploy.email.<stage>.from.`
				: `Email '${id}' has from: '${from}', which is not a mail local part. Set it to what goes before the @, like 'info' or 'noreply'.`,
		);
		this.name = 'EmailFromNotALocalPart';
	}
}

export class Email<
	TName extends string = string,
	TTemplates extends TemplateRecord = TemplateRecord,
> implements Construct<TName, EmailClient<TTemplates>>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, EmailClient<TTemplates>>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * build publishes and the key the client reads cannot drift.
	 */
	private readonly keys: { url: string; from: string };

	constructor(
		id: ConstructName<TName>,
		private readonly options: EmailOptions<TTemplates>,
	) {
		const canonical = canonicalId(id as string);
		if (options.from !== undefined && !LOCAL_PART.test(options.from)) {
			throw new EmailFromNotALocalPart(canonical, options.from);
		}

		this.id = canonical as TName;
		this.keys = {
			url: providedKeyFor(canonical, 'email', 'url'),
			// The whole address arrives with the URL: its domain is the stage's,
			// so only the local part (`options.from`) is written here.
			from: providedKeyFor(canonical, 'email', 'from'),
		};

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'email',
				id: this.id,
				provides: [this.keys.url, this.keys.from],
				...(this.options.from ? { from: this.options.from } : {}),
			},
		];
	}

	/**
	 * Builds the client from the URL the adapter supplied.
	 *
	 * No provider branch and no driver lookup — `parseEmailUrl` turns any of
	 * Mailpit, SES, or Resend into the same transport config, which is the whole
	 * reason the scheme is always `smtp://`.
	 */
	private async connect({
		envParser,
	}: ServiceRegisterOptions): Promise<EmailClient<TTemplates>> {
		const { url, from } = envParser
			.create((get) => ({
				url: get(this.keys.url).string(),
				from: get(this.keys.from).string(),
			}))
			.parse();

		// Loaded here, not at the top: the test harness names this construct in
		// every app, and an app that sends no mail does not install emailkit.
		const { createEmailClient, parseEmailUrl } = await loadEmailkit();
		return createEmailClient({
			smtp: parseEmailUrl(url),
			templates: this.options.templates,
			defaults: {
				from,
				...(this.options.replyTo ? { replyTo: this.options.replyTo } : {}),
			},
		});
	}
}
