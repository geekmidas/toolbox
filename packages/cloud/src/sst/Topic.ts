import { type GkmLinkable, ResourceType } from './Linkable';
import type { StackType } from './Stack';

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
}

export interface TopicProps extends sst.aws.SnsTopicArgs {}
