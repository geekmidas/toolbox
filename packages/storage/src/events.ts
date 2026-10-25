/**
 * Object events — what a bucket says happened to its objects, in words that
 * name no cloud.
 *
 * S3 and MinIO notify in the same shape: a body with `Records`, each naming
 * the event (`ObjectCreated:Put`, or `s3:ObjectCreated:Put` on MinIO) and the
 * object, its key URL-encoded the way a form is (`a+b.png` for `a b.png`).
 * This reads either into `{ type: 'object.created', payload }`, the message
 * shape every subscriber already handles.
 */

/** What happened to an object. */
export type ObjectEventType = 'object.created' | 'object.deleted';

/** The event types a bucket's subscribers can name. */
export const OBJECT_EVENT_TYPES: readonly ObjectEventType[] = [
	'object.created',
	'object.deleted',
];

/** One object, as an event names it. */
export interface ObjectEvent {
	/** The bucket's name, as the storage knows it. */
	bucket: string;
	/** The object's key, decoded. */
	key: string;
	/** Its size in bytes. Absent on a delete. */
	size?: number;
	/** Its entity tag, quotes removed. Absent on a delete. */
	etag?: string;
	/** The version written or removed, on a versioned bucket. */
	versionId?: string;
}

/** An object event as a message: what a subscriber is handed. */
export interface ObjectMessage<
	TType extends ObjectEventType = ObjectEventType,
> {
	type: TType;
	payload: ObjectEvent;
}

/** Which keys a subscriber wants: those under `prefix` and ending in `suffix`. */
export interface ObjectFilter {
	prefix?: string;
	suffix?: string;
}

/** A notification body that is not one the storage sends. */
export class ObjectNotificationMalformed extends Error {
	constructor(readonly reason: string) {
		super(
			`An object notification could not be read: ${reason}. A bucket's ` +
				`notifications are a JSON body with a 'Records' array, as S3 and ` +
				`MinIO send them — check what is publishing to this subscriber.`,
		);
		this.name = 'ObjectNotificationMalformed';
	}
}

/**
 * The object events in a notification body — S3's or MinIO's, as an object
 * or as the JSON string SNS carries it in.
 *
 * A test event — S3 sends one when a notification is configured — is no
 * event, so it reads as none. So does any record that is neither a write nor
 * a delete: a restore, a replication, a lifecycle transition.
 *
 * @throws {ObjectNotificationMalformed} when the body is not a notification
 */
export function toObjectEvents(body: unknown): ObjectMessage[] {
	const notification = typeof body === 'string' ? parse(body) : body;
	if (!isRecord(notification)) {
		throw new ObjectNotificationMalformed('it is not a JSON object');
	}
	if (isTestEvent(notification)) return [];

	const { Records: records } = notification;
	if (!Array.isArray(records)) {
		throw new ObjectNotificationMalformed('it has no Records array');
	}

	const messages: ObjectMessage[] = [];
	for (const record of records) {
		if (!isRecord(record)) {
			throw new ObjectNotificationMalformed('a record is not an object');
		}
		const type = eventType(record.eventName);
		if (!type) continue;

		const s3 = isRecord(record.s3) ? record.s3 : undefined;
		const bucket = isRecord(s3?.bucket) ? s3.bucket.name : undefined;
		const object = isRecord(s3?.object) ? s3.object : undefined;
		if (typeof bucket !== 'string' || typeof object?.key !== 'string') {
			throw new ObjectNotificationMalformed(
				'a record names no bucket or no object key',
			);
		}

		const payload: ObjectEvent = { bucket, key: decodeKey(object.key) };
		if (typeof object.size === 'number') payload.size = object.size;
		const etag = object.eTag ?? object.etag;
		if (typeof etag === 'string' && etag) {
			payload.etag = etag.replace(/^"|"$/g, '');
		}
		if (typeof object.versionId === 'string' && object.versionId) {
			payload.versionId = object.versionId;
		}
		messages.push({ type, payload });
	}
	return messages;
}

/** Whether the event's key is under the filter's prefix and ends in its suffix. */
export function matchesObjectFilter(
	event: Pick<ObjectEvent, 'key'>,
	filter: ObjectFilter = {},
): boolean {
	if (filter.prefix && !event.key.startsWith(filter.prefix)) return false;
	if (filter.suffix && !event.key.endsWith(filter.suffix)) return false;
	return true;
}

/** `ObjectCreated:Put` or `s3:ObjectCreated:Put` → `object.created`. */
function eventType(name: unknown): ObjectEventType | undefined {
	if (typeof name !== 'string') return undefined;
	const bare = name.startsWith('s3:') ? name.slice(3) : name;
	if (bare.startsWith('ObjectCreated:')) return 'object.created';
	if (bare.startsWith('ObjectRemoved:')) return 'object.deleted';
	return undefined;
}

/**
 * A key as the storage encodes it in a notification: form-encoded, so a
 * space is `+` and a literal `+` is `%2B`.
 */
function decodeKey(key: string): string {
	const spaced = key.replace(/\+/g, ' ');
	try {
		return decodeURIComponent(spaced);
	} catch {
		// A lone `%` the storage did not encode: the key as written.
		return spaced;
	}
}

function isTestEvent(notification: Record<string, unknown>): boolean {
	return (
		notification.Event === 's3:TestEvent' ||
		notification.EventName === 's3:TestEvent'
	);
}

function parse(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		throw new ObjectNotificationMalformed('it is not JSON');
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
