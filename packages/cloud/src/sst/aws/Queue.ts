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
		const { queueName, ...args } = props;

		super(name, {
			...args,
			// A supplied name has to satisfy SQS's rule; an auto-generated one is
			// Pulumi's problem and it already handles it.
			...(queueName
				? {
						transform: {
							...args.transform,
							queue: { name: fifoName(queueName, args.fifo) },
						},
					}
				: {}),
		});
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

export interface QueueProps extends sst.aws.QueueArgs {
	/**
	 * The physical queue name, where the auto-generated one will not do.
	 *
	 * Normalised for SQS's FIFO rule — see {@link fifoName}. This is a separate
	 * prop rather than a `transform` because the rule is easy to not know and
	 * expensive to discover: the deploy fails at the API call, long after the
	 * plan looked fine.
	 */
	queueName?: string;
}

/**
 * A FIFO queue's name must end in `.fifo`, and a standard queue's must not.
 *
 * AWS rejects either mistake at the API call rather than at plan time, so the
 * component fixes it where the fact lives instead of leaving it as something
 * every caller has to remember. Appending is safe: `.fifo` counts toward the
 * 80-character limit, so a name already carrying it must not get a second one.
 */
export function fifoName(
	name: string,
	fifo: sst.aws.QueueArgs['fifo'],
): string {
	// `fifo` is an Input and may be an object (`{ contentBasedDeduplication }`),
	// which is still FIFO — only `false` and `undefined` are not.
	const isFifo = fifo !== undefined && fifo !== false;

	if (!isFifo) return name.replace(/\.fifo$/, '');

	return name.endsWith('.fifo') ? name : `${name}.fifo`;
}
