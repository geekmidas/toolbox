import { type GkmLinkable, ResourceType } from './Linkable';
import type { StackType } from './Stack';

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

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, arn: this.arn },
		};
	}
}

export interface QueueProps extends sst.aws.QueueArgs {}
