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

	get _type() {
		return ResourceType.Email;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: EmailProps,
	) {
		this._id = name;
		this.url =
			props.backend === 'ses' ? this.provisionSes(name, props) : props.url;
	}

	/**
	 * One key, the `smtp://` URL — and a second the app declared, the sending
	 * identity, which is the one thing about mail that genuinely differs per
	 * stage.
	 */
	provides(): Record<string, $util.Input<string>> {
		return { url: this.url };
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
	 * The `smtp://` URL, for the backends that are handed one.
	 *
	 * Required for `resend` and `smtp`, ignored for `ses` — which derives its
	 * own, because the credential does not exist until the user does.
	 */
	url?: $util.Input<string>;
	/** The region to derive SES credentials for. Required for `ses`. */
	region?: $util.Input<string>;
}
