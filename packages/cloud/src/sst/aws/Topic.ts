// The codec alone — see the note in `Queue.ts`.
import * as snsUrl from '@geekmidas/events/sns/url';
import { type GkmLinkable, ResourceType } from '../Linkable';
import { regionOfArn } from '../naming';
import type { StackType } from '../Stack';

/**
 * `Topic` — a linkable SNS topic (wraps `sst.aws.SnsTopic`), the pub/sub fan-out
 * bus. Link it to a publisher and the runtime resolves `<NAME>_ARN` and a
 * `<NAME>_PUBLISHER_CONNECTION_STRING` (`sns://?topicArn=…`) that
 * `@geekmidas/events`'s `Publisher.fromConnectionString` consumes. Subscribers
 * attach via `TopicSubscriber`/`Subscriber`.
 *
 * `StorageProps`-style: `TopicProps` extends `sst.aws.SnsTopicArgs`.
 * Source-only (extends ambient `sst.aws.*`); see docs §2.
 */
export class Topic<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.SnsTopic
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.SnsTopic;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: TopicProps = {},
	) {
		super(name, props);
		this._id = name;
	}

	/**
	 * The publisher's connection string, and nothing else.
	 *
	 * A subscriber is *bound* to a topic rather than depending on it, so the
	 * binding is an edge the deploy target reads and not a key anyone can hold —
	 * which is what keeps a subscriber from being able to publish.
	 *
	 * The region comes out of the topic's own ARN, for the same reason it does
	 * on a queue: the reader's region is not the resource's.
	 */
	provides(): Record<string, $util.Input<string>> {
		return {
			publisherConnectionString: $util
				.output(this.arn)
				.apply((topicArn) =>
					snsUrl.build({ topicArn, region: regionOfArn(topicArn) }),
				),
		};
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

export interface TopicProps extends sst.aws.SnsTopicArgs {}
