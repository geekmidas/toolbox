// The codec alone — see the note in `Queue.ts`.
import * as snsUrl from '@geekmidas/events/sns/url';
import { providedKeyFor } from '@geekmidas/manifest';
import { type GkmLinkable, ResourceType } from '../Linkable';
import { regionOfArn } from '../naming';
import type { StackType } from '../Stack';

/**
 * `Inbox` — mail received, as SST links it. It provisions nothing.
 *
 * What receives the mail is the inbox's provider's, created by `gkm deploy`
 * before SST runs, as it is on a compose stage: the SES receipt rule, the
 * bucket the raw messages are stored in, the topic each is announced on, the
 * domain's MX and DKIM records. The deploy hands SST what that made, read
 * from the stage's secrets by the rule every target reads it by, as env:
 *
 * - `<ID>_URL` — where the raw messages are read, with the provider's key;
 * - `<ID>_DOMAIN` — the stage's domain, which mail is addressed to;
 * - `<TOPIC>_PUBLISHER_CONNECTION_STRING` — the topic, whose ARN its
 *   subscribers are subscribed to.
 *
 * Each can be passed instead (`fromManifest(…, { Requests: { url, domain,
 * topic } })`), which is what a test does.
 */
export class Inbox<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	/** The ARN of the topic the provider publishes each receipt on. */
	readonly topicArn: string;

	private readonly url: string;

	private readonly domain: string;

	get _type() {
		return ResourceType.Inbox;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: InboxProps,
	) {
		this._id = name;
		const env = props.env ?? process.env;
		const read = (given: string | undefined, key: string): string => {
			const value = given ?? env[key];
			if (!value) throw new InboxNotProvisioned(name, key);
			return value;
		};

		this.url = read(props.url, providedKeyFor(name, 'inbox', 'url'));
		this.domain = read(props.domain, providedKeyFor(name, 'inbox', 'domain'));
		this.topicArn = snsUrl.parse(
			read(
				props.topic,
				providedKeyFor(props.topicId, 'topic', 'publisherConnectionString'),
			),
		).topicArn;
	}

	provides(): Record<string, $util.Input<string>> {
		return { url: this.url, domain: this.domain };
	}

	getSSTLink() {
		return { properties: { ...this.provides() } };
	}
}

export interface InboxProps {
	/** The id of the topic the inbox declared — the provider's, by name. */
	topicId: string;
	/** Where the raw messages are read. `<ID>_URL` from the deploy otherwise. */
	url?: string;
	/** The domain mail is addressed to. `<ID>_DOMAIN` from the deploy otherwise. */
	domain?: string;
	/** The topic's `sns://` string. `<TOPIC>_PUBLISHER_CONNECTION_STRING` otherwise. */
	topic?: string;
	/** Where the deploy's values are read; `process.env` by default. */
	env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The topic an inbox declared, as its provider made it: referenced, never
 * created, so SST cannot make a second topic SES never publishes to.
 *
 * Nothing depends on it — only SES publishes to it — so what it provides is
 * there for the declaration's contract, not for any producer.
 */
export class InboxTopic implements GkmLinkable {
	readonly _id: string;

	get _type() {
		return ResourceType.SnsTopic;
	}

	constructor(
		name: string,
		private readonly inbox: Inbox,
	) {
		this._id = name;
	}

	get arn(): string {
		return this.inbox.topicArn;
	}

	provides(): Record<string, $util.Input<string>> {
		return {
			publisherConnectionString: snsUrl.build({
				topicArn: this.arn,
				region: regionOfArn(this.arn),
			}),
		};
	}

	getSSTLink() {
		return { properties: { arn: this.arn, ...this.provides() } };
	}
}

/** An inbox's value is neither passed nor in the deploy's env. */
export class InboxNotProvisioned extends Error {
	constructor(
		readonly id: string,
		readonly key: string,
	) {
		super(
			`'${id}' receives mail, and ${key} is not set. Its provider makes it: ` +
				`deploy with \`gkm deploy --target sst\`, which runs the stage's ` +
				`inbox provider (deploy.inbox.<stage> = { provider: 'ses' }) and ` +
				`hands SST what it made — or pass it to fromManifest.`,
		);
		this.name = 'InboxNotProvisioned';
	}
}
