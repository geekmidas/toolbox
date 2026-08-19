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

import {
	createEmailClient,
	type EmailClient,
	parseEmailUrl,
	type TemplateRecord,
} from '@geekmidas/emailkit';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';

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
	 * A reply-to address for every send.
	 *
	 * `from` is deliberately absent: it belongs to the verified sending domain,
	 * which is `myapp.test` locally and the real domain deployed, so it arrives
	 * as stage config rather than being written here.
	 */
	replyTo?: string;
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

		this.id = canonical as TName;
		this.keys = {
			url: provideKey(canonical, 'url'),
			// The sending identity travels with the URL rather than being a second
			// construct option, for the same reason the URL does: it is the one
			// thing about mail that differs per stage.
			from: provideKey(canonical, 'from'),
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
