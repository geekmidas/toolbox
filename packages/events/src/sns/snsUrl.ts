/**
 * The `sns://` connection-string codec — how a topic is addressed as one string.
 *
 * The twin of `sqsUrl`, and separate from it for the same reason `gs://` would
 * be separate from `s3://`: a topic ARN and a queue URL are different
 * vocabularies, and a shared codec would have to contain both. What they share
 * is only the rule that a construct provides one string.
 *
 * Both directions live here so they cannot drift: `parse(build(x))` is `x`.
 */

/** What an SNS connection string addresses. */
export interface SnsAddress {
	topicArn: string;
	/** Read off the topic, never inherited: a topic may live in another region. */
	region?: string;
	/** Set for SNS-compatible backends such as LocalStack. */
	endpoint?: string;
	/**
	 * The queue a subscriber drains.
	 *
	 * Present only on the subscriber's string: fan-out delivers to a queue per
	 * subscriber, so the publisher's string names the topic and nothing else.
	 */
	queueName?: string;
}

const SCHEME = 'sns:';

/**
 * Compose an address into a connection string.
 *
 * Credentials never appear, for the same reason they never appear in an
 * `s3://` URL: the SDK resolves them from its own chain.
 */
export function build(address: SnsAddress): string {
	const { topicArn, region, endpoint, queueName } = address;
	if (!topicArn) throw new MissingTopicArn('');

	const url = new URL(`${SCHEME}//`);
	url.searchParams.set('topicArn', topicArn);
	if (region) url.searchParams.set('region', region);
	if (endpoint) url.searchParams.set('endpoint', endpoint);
	if (queueName) url.searchParams.set('queueName', queueName);

	return url.toString();
}

/** Parse a connection string back into an address. */
export function parse(connectionString: string): SnsAddress {
	let parsed: URL;
	try {
		parsed = new URL(connectionString);
	} catch {
		throw new MalformedTopicUrl(connectionString);
	}

	if (parsed.protocol !== SCHEME) {
		throw new UnexpectedTopicScheme(connectionString, SCHEME, parsed.protocol);
	}

	const topicArn = parsed.searchParams.get('topicArn');
	if (!topicArn) throw new MissingTopicArn(connectionString);

	const region = parsed.searchParams.get('region') ?? undefined;
	const endpoint = parsed.searchParams.get('endpoint') ?? undefined;
	const queueName = parsed.searchParams.get('queueName') ?? undefined;

	return {
		topicArn,
		...(region ? { region } : {}),
		...(endpoint ? { endpoint } : {}),
		...(queueName ? { queueName } : {}),
	};
}

/** The string is not a URL at all. */
export class MalformedTopicUrl extends Error {
	constructor(readonly url: string) {
		super(`'${url}' is not a valid connection string.`);
		this.name = 'MalformedTopicUrl';
	}
}

/** The string is a URL, but not an `sns://` one. */
export class UnexpectedTopicScheme extends Error {
	constructor(
		readonly url: string,
		readonly expected: string,
		readonly actual: string,
	) {
		super(
			`Expected a '${expected}//' connection string and got '${actual}//' in '${url}'.`,
		);
		this.name = 'UnexpectedTopicScheme';
	}
}

/** An `sns://` string with no topic names nothing. */
export class MissingTopicArn extends Error {
	constructor(readonly url: string) {
		super(
			url
				? `'${url}' names no topic: an sns:// connection string needs ?topicArn=.`
				: 'An sns:// connection string needs a topicArn.',
		);
		this.name = 'MissingTopicArn';
	}
}
