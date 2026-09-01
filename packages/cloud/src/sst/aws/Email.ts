import { iam } from '@pulumi/aws';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';
import { sesSmtpUrl } from './ses';

/**
 * `Email` — outbound mail, and the infra half of the `email` kind.
 *
 * The kind whose backends differ least. Every one of them speaks SMTP, so the
 * declaration's `smtp://` URL is true of all of them and the client never
 * changes — Mailpit locally, Resend or SES or somebody's relay deployed. What
 * differs is only who issues the credential, which is why the backend is config
 * rather than a field on the construct.
 *
 * Two of the three are barely a component: `resend` and `smtp` compose a URL
 * from a value you already hold. Only `ses` provisions anything, and it
 * provisions a *chain* — an identity, a user, an access key, and a password
 * derived from that key — because SES does not issue SMTP passwords, it issues
 * IAM credentials and documents the arithmetic.
 */
export class Email<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	/** Composed once, in the constructor, so `provides` cannot drift from it. */
	private readonly url: $util.Input<string>;

	/**
	 * The address mail is sent from.
	 *
	 * Required rather than defaulted: an unverified sender is rejected by every
	 * provider, and a guess would be rejected at the first send rather than at
	 * synth.
	 */
	private readonly from: $util.Input<string>;

	get _type() {
		return ResourceType.Email;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: EmailProps,
	) {
		this._id = name;

		// A supplied URL wins over provisioning, for every backend including SES.
		// Credentials that already exist are the common case — a sending identity
		// set up once, by hand — and creating a second IAM user for it would be
		// this deploy quietly adding another way into the account.
		this.url = props.url ?? this.provision(name, props);
		this.from = props.from;
	}

	/**
	 * Mint a credential, for the one backend that can.
	 *
	 * @throws {EmailNeedsUrl} for the backends that cannot. Resend and a plain
	 * relay *are* accounts somebody created, so a missing URL is a missing setup
	 * step — and saying so at synth beats composing something that cannot
	 * deliver and finding out at the first send.
	 */
	private provision(name: string, props: EmailProps): $util.Input<string> {
		if (props.backend !== 'ses') throw new EmailNeedsUrl(name, props.backend);

		return this.provisionSes(name, props);
	}

	/**
	 * One key, the `smtp://` URL — and a second the app declared, the sending
	 * identity, which is the one thing about mail that genuinely differs per
	 * stage.
	 */
	provides(): Record<string, $util.Input<string>> {
		return { url: this.url, from: this.from };
	}

	getSSTLink() {
		return { properties: { ...this.provides() } };
	}

	/**
	 * The SES chain: a user that may send, a key for it, and the derived password.
	 *
	 * A user of its own rather than the application's role, because SMTP is a
	 * long-lived static credential and the execution role is not — there is no
	 * way to hand a relay a rotating token. Scoped to `ses:SendRawEmail` and
	 * nothing else, so a leaked SMTP password sends mail and does not read the
	 * account's send statistics or verify new identities.
	 */
	private provisionSes(name: string, props: EmailProps): $util.Input<string> {
		const user = new iam.User(`${name}SmtpUser`, {
			path: '/gkm/ses/',
		});

		new iam.UserPolicy(`${name}SmtpPolicy`, {
			user: user.name,
			policy: JSON.stringify({
				Version: '2012-10-17',
				Statement: [
					{ Effect: 'Allow', Action: 'ses:SendRawEmail', Resource: '*' },
				],
			}),
		});

		const key = new iam.AccessKey(`${name}SmtpKey`, { user: user.name });

		return $util
			.all([key.id, key.secret, props.region])
			.apply(([accessKeyId, secretAccessKey, region]) =>
				sesSmtpUrl({ accessKeyId, secretAccessKey, region }),
			);
	}
}

export interface EmailProps {
	/** Who delivers the mail. Only `ses` provisions anything. */
	backend: 'resend' | 'ses' | 'smtp';
	/**
	 * The `smtp://` URL, where the credentials already exist.
	 *
	 * Required for `resend` and `smtp`, which are accounts rather than
	 * infrastructure. Optional for `ses`, and supplying it is the difference
	 * between using the sending identity you have and provisioning a second one.
	 */
	url?: $util.Input<string>;
	/** The region to derive SES credentials for. Required for `ses`. */
	region?: $util.Input<string>;
	/**
	 * The identity mail is sent from — a verified address or domain.
	 *
	 * Stage-varying by nature, which is why it is here rather than on the
	 * construct: `noreply@myapp.test` locally, a verified domain deployed.
	 */
	from: $util.Input<string>;
}

/**
 * A backend that cannot mint its own credentials was given none.
 *
 * Resend and a plain relay are accounts somebody created, so there is nothing
 * for a deploy to provision and a missing URL is a missing setup step.
 */
export class EmailNeedsUrl extends Error {
	constructor(
		readonly id: string,
		readonly backend: string,
	) {
		super(
			`'${id}' sends through ${backend}, which is an account rather than ` +
				`something to provision, and no URL was supplied for it. Set it with ` +
				`\`sst secret set\` and pass it through the deploy layer — ` +
				`fromManifest(stack, manifest, { ${id}: { url } }).`,
		);
		this.name = 'EmailNeedsUrl';
	}
}

/**
 * Mail was declared and no sending identity was supplied.
 *
 * Not defaultable: every provider rejects an unverified sender, so a guess would
 * deploy cleanly and fail at the first send. The address is also stage-varying
 * by nature, which is why it belongs in the deploy layer rather than the
 * construct.
 */
export class EmailNeedsSender extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' sends mail and no sending identity was supplied. Pass one ` +
				`through the deploy layer — ` +
				`fromManifest(stack, manifest, { ${id}: { from: 'noreply@example.com' } }) ` +
				`— and make sure it is verified with the provider.`,
		);
		this.name = 'EmailNeedsSender';
	}
}
