import { GkmError } from '../../errors';

/** `deploy.inbox.<stage>` or `deploy.email.<stage>` holds a field the `ses` provider does not take. */
export class SesProviderConfigInvalid extends GkmError {
	constructor(
		readonly kind: 'inbox' | 'email',
		readonly stage: string,
		readonly field: string,
		readonly value: unknown,
		readonly expected: string,
	) {
		super(
			`deploy.${kind}.${stage}.${field} is ${JSON.stringify(value)}; ${expected}.`,
		);
		this.name = 'SesProviderConfigInvalid';
	}
}

/** The stage's region is one SES does not receive mail in. */
export class SesReceivingUnsupported extends GkmError {
	constructor(
		readonly stage: string,
		readonly region: string,
		readonly regions: readonly string[],
	) {
		super(
			`'${stage}' is in ${region}, where SES does not receive mail. Set ` +
				`deploy.inbox.${stage}.region to one that does: ${regions.join(', ')}.`,
		);
		this.name = 'SesReceivingUnsupported';
	}
}

/** An inbox whose keys the stage's secrets do not hold: not provisioned yet. */
export class InboxNotProvisioned extends GkmError {
	constructor(
		readonly stage: string,
		readonly inbox: string,
		readonly missing: readonly string[],
	) {
		super(
			`'${inbox}' has no ${missing.join(' or ')} in '${stage}''s secrets, so ` +
				`it receives nothing. Deploy the stage with credentials for its AWS ` +
				`account: the ses provider creates the inbox and writes them.`,
		);
		this.name = 'InboxNotProvisioned';
	}
}

/** A mail construct whose keys the stage's secrets do not hold: not provisioned yet. */
export class EmailNotProvisioned extends GkmError {
	constructor(
		readonly stage: string,
		readonly email: string,
		readonly missing: readonly string[],
	) {
		super(
			`'${email}' has no ${missing.join(' or ')} in '${stage}''s secrets, so ` +
				`it sends nothing. Deploy the stage with credentials for its AWS ` +
				`account: the ses provider creates its sender and writes them.`,
		);
		this.name = 'EmailNotProvisioned';
	}
}

/**
 * A stage whose mail is sent from its own domain, and no domain for it —
 * set `domains.<stage>`, or name the sender with `deploy.email.<stage>.from`.
 */
export class EmailSenderUnknown extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.email.${stage} is ses, which sends from an address on the ` +
				`stage's domain, and '${stage}' has none. Set domains.${stage}, or ` +
				`name the sender: deploy.email.${stage}.from = 'noreply@example.com'.`,
		);
		this.name = 'EmailSenderUnknown';
	}
}
