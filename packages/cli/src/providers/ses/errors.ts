import { GkmError } from '../../errors';

/** `deploy.inbox.<stage>` holds a field the `ses` provider does not take. */
export class SesProviderConfigInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly field: string,
		readonly value: unknown,
		readonly expected: string,
	) {
		super(
			`deploy.inbox.${stage}.${field} is ${JSON.stringify(value)}; ${expected}.`,
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
