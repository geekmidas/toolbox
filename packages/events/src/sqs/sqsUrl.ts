/**
 * The `sqs://` connection-string codec — how a queue is addressed as one string.
 *
 * It lives beside the client rather than in a neutral package because
 * `queueUrl`, `region`, and `endpoint` are SQS's vocabulary. The neutral layer
 * knows only that a queue provides *one* connection string; what that string
 * says is between the component that composes it and the publisher that parses
 * it. The `pgboss://` form sits beside its own client and shares nothing here.
 *
 * Both directions live in this module so they cannot drift: `parse(build(x))`
 * is `x`, and the deploy target composing a string it cannot parse back is the
 * failure this shape rules out.
 */

/** What an SQS connection string addresses. */
export interface SqsAddress {
	queueUrl: string;
	/** Read off the queue, never inherited: a queue may live in another region. */
	region?: string;
	/** Set for SQS-compatible backends such as LocalStack. */
	endpoint?: string;
	/** Largest batch the publisher may send in one call. */
	maxBatchSize?: number;
}

const SCHEME = 'sqs:';

/**
 * Compose an address into a connection string.
 *
 * Credentials never appear. The AWS SDK resolves them from its own chain — an
 * execution role deployed, environment locally — so the string stays safe to log
 * and identical across environments that differ only in who is calling.
 */
export function build(address: SqsAddress): string {
	const { queueUrl, region, endpoint, maxBatchSize } = address;
	if (!queueUrl) throw new MissingQueueUrl('');

	const url = new URL(`${SCHEME}//`);
	url.searchParams.set('queueUrl', queueUrl);
	if (region) url.searchParams.set('region', region);
	if (endpoint) url.searchParams.set('endpoint', endpoint);
	if (maxBatchSize !== undefined) {
		url.searchParams.set('maxBatchSize', String(maxBatchSize));
	}

	return url.toString();
}

/** Parse a connection string back into an address. */
export function parse(connectionString: string): SqsAddress {
	let parsed: URL;
	try {
		parsed = new URL(connectionString);
	} catch {
		throw new MalformedQueueUrl(connectionString);
	}

	if (parsed.protocol !== SCHEME) {
		throw new UnexpectedQueueScheme(connectionString, SCHEME, parsed.protocol);
	}

	const queueUrl = parsed.searchParams.get('queueUrl');
	if (!queueUrl) throw new MissingQueueUrl(connectionString);

	const region = parsed.searchParams.get('region') ?? undefined;
	const endpoint = parsed.searchParams.get('endpoint') ?? undefined;
	const batch = parsed.searchParams.get('maxBatchSize');

	return {
		queueUrl,
		...(region ? { region } : {}),
		...(endpoint ? { endpoint } : {}),
		...(batch ? { maxBatchSize: Number(batch) } : {}),
	};
}

/** The string is not a URL at all. */
export class MalformedQueueUrl extends Error {
	constructor(readonly url: string) {
		super(`'${url}' is not a valid connection string.`);
		this.name = 'MalformedQueueUrl';
	}
}

/** The string is a URL, but not an `sqs://` one. */
export class UnexpectedQueueScheme extends Error {
	constructor(
		readonly url: string,
		readonly expected: string,
		readonly actual: string,
	) {
		super(
			`Expected a '${expected}//' connection string and got '${actual}//' in '${url}'.`,
		);
		this.name = 'UnexpectedQueueScheme';
	}
}

/** An `sqs://` string with no queue names nothing. */
export class MissingQueueUrl extends Error {
	constructor(readonly url: string) {
		super(
			url
				? `'${url}' names no queue: an sqs:// connection string needs ?queueUrl=.`
				: 'An sqs:// connection string needs a queueUrl.',
		);
		this.name = 'MissingQueueUrl';
	}
}
