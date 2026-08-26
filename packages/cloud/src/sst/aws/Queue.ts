import { sqsUrl } from '@geekmidas/events/sqs';
import { type GkmLinkable, ResourceType } from '../Linkable';
import { regionOfArn } from '../naming';
import type { StackType } from '../Stack';

/**
 * `Queue` — a linkable SQS queue (wraps `sst.aws.Queue`), the point-to-point
 * work queue. Link it to a producer and the runtime resolves `<NAME>_URL`,
 * `<NAME>_ARN`, and a `<NAME>_PUBLISHER_CONNECTION_STRING` (`sqs://?queueUrl=…`)
 * that `@geekmidas/events`'s `Publisher.fromConnectionString` consumes. Its
 * single consumer is wired by `QueueSubscriber`.
 *
 * SST's native `Queue` link exposes only `url`, so `getSSTLink` is overridden to
 * also expose `arn` (what the resolver needs). `QueueProps` extends
 * `sst.aws.QueueArgs`. Source-only (extends ambient `sst.aws.*`); see docs §2.
 */
export class Queue<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Queue
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.Queue;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: QueueProps = {},
	) {
		super(name, props);
		this._id = name;
	}

	/**
	 * The values this queue resolves onto anything that publishes to it, keyed
	 * by role. One key, the producer's: a worker is reached *through* the queue,
	 * so there is no second address and nothing can depend on the handler.
	 *
	 * The region is read out of the queue's own ARN rather than left for the SDK
	 * to infer. `AWS_REGION` inside a Lambda is the *function's* region, so a
	 * connection string that omits it works until the day the queue lives
	 * somewhere else and then fails at runtime with nothing to point at.
	 */
	provides(): Record<string, $util.Input<string>> {
		return {
			publisherConnectionString: $util
				.all([this.url, this.arn])
				.apply(([queueUrl, arn]) =>
					sqsUrl.build({ queueUrl, region: regionOfArn(arn) }),
				),
		};
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, arn: this.arn, ...this.provides() },
		};
	}
}

export interface QueueProps extends sst.aws.QueueArgs {}
