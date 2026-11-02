/**
 * The shape a surface's frames take on the wire.
 *
 * By default a frame is `{ "action": …, "id"?: …, "data": … }` — API
 * Gateway's shape. A surface that names a discriminator — `frame: {
 * discriminator: 'type' }` — sends and reads flat frames instead: the action
 * under that key, and the data's own fields beside it.
 *
 * ```json
 * {"type":"chat.message.created","chatId":"c1","message":{…}}
 * ```
 *
 * A flat frame has no `id` of its own: every field but the discriminator is
 * the data, so a reply is paired by its action, not an echoed id.
 */

import { toJsonSchema } from '@geekmidas/schema/conversion';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { WebSocketMessages } from './publisher';

/** `WebSocketApiConfig.frame`: where a flat frame keeps its action. */
export interface WebSocketFrame {
	/** The key a frame's action lives in — `type` for `{ "type": … }`. */
	discriminator: string;
}

/** A frame as the server reads it, whatever shape it arrived in. */
export interface DecodedFrame {
	action: string;
	/** Echoed on the reply. Only an `{ action, data }` frame carries one. */
	id?: string | number;
	data?: unknown;
}

/** A declared message whose schema does not describe an object. */
export class WebSocketMessageNotAnObject extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly discriminator: string,
	) {
		super(
			`${surface} sends flat frames, keyed by '${discriminator}', so each message's fields sit beside it — but '${action}' is not an object schema. Declare it as an object (z.object({ … })), or drop \`frame\` to send { action, data }.`,
		);
		this.name = 'WebSocketMessageNotAnObject';
	}
}

/** A declared message whose schema has a field named the discriminator. */
export class WebSocketMessageDeclaresDiscriminator extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly discriminator: string,
	) {
		super(
			`${surface}'s '${action}' message declares a '${discriminator}' field, which is where its flat frames keep the action. Rename the field, or give \`frame.discriminator\` a key no message uses.`,
		);
		this.name = 'WebSocketMessageDeclaresDiscriminator';
	}
}

/** Data sent in a flat frame that is not an object. */
export class WebSocketDataNotAnObject extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly discriminator: string,
	) {
		super(
			`${surface} sends flat frames, keyed by '${discriminator}', and '${action}''s data is not an object, so it has no fields to put beside it. Send an object. Nothing was sent.`,
		);
		this.name = 'WebSocketDataNotAnObject';
	}
}

/** Data sent in a flat frame that carries the discriminator itself. */
export class WebSocketDataHasDiscriminator extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly discriminator: string,
	) {
		super(
			`'${action}''s data on ${surface} has a '${discriminator}' field, which is where its flat frames keep the action. Rename the field. Nothing was sent.`,
		);
		this.name = 'WebSocketDataHasDiscriminator';
	}
}

/** How one surface writes and reads its frames. */
export class FrameShape {
	constructor(
		readonly surface: string,
		/** The flat frame's key; absent, frames are `{ action, data }`. */
		readonly discriminator?: string,
	) {}

	/** The key an inbound frame names its action under. */
	get key(): string {
		return this.discriminator ?? 'action';
	}

	/**
	 * The frame for `action`'s `data`, serialised.
	 *
	 * @throws {WebSocketDataNotAnObject}, {WebSocketDataHasDiscriminator} for
	 *   a flat frame whose data cannot sit beside the discriminator.
	 */
	encode(action: string, data: unknown, id?: string | number): string {
		const { discriminator } = this;
		if (discriminator === undefined) {
			return JSON.stringify({
				action,
				...(id !== undefined ? { id } : {}),
				data,
			});
		}
		if (!isRecord(data)) {
			throw new WebSocketDataNotAnObject(this.surface, action, discriminator);
		}
		if (Object.hasOwn(data, discriminator)) {
			throw new WebSocketDataHasDiscriminator(
				this.surface,
				action,
				discriminator,
			);
		}
		return JSON.stringify({ [discriminator]: action, ...data });
	}

	/** A parsed frame's action, id and data — `undefined` when it names none. */
	decode(frame: unknown): DecodedFrame | undefined {
		if (!isRecord(frame)) return undefined;
		const { discriminator } = this;
		if (discriminator === undefined) {
			if (typeof frame.action !== 'string') return undefined;
			return {
				action: frame.action,
				...(isId(frame.id) ? { id: frame.id } : {}),
				data: frame.data,
			};
		}
		const { [discriminator]: action, ...data } = frame;
		if (typeof action !== 'string') return undefined;
		return { action, data };
	}

	/** The id a frame that names no action carried, to echo on its error. */
	idOf(frame: unknown): string | number | undefined {
		if (this.discriminator !== undefined || !isRecord(frame)) return undefined;
		return isId(frame.id) ? frame.id : undefined;
	}

	/**
	 * Refuse a declared message a flat frame cannot carry: one that is not an
	 * object, or that has a field named the discriminator.
	 *
	 * @throws {WebSocketMessageNotAnObject}, {WebSocketMessageDeclaresDiscriminator}
	 */
	check(messages: WebSocketMessages): void {
		const { discriminator } = this;
		if (discriminator === undefined) return;
		for (const [action, schema] of Object.entries(messages)) {
			const shape = objectShape(toJsonSchema(schema as StandardSchemaV1));
			if (!shape) {
				throw new WebSocketMessageNotAnObject(
					this.surface,
					action,
					discriminator,
				);
			}
			if (shape.has(discriminator)) {
				throw new WebSocketMessageDeclaresDiscriminator(
					this.surface,
					action,
					discriminator,
				);
			}
		}
	}
}

/**
 * The fields a JSON Schema's object declares, or `undefined` when it is not
 * an object. A union or intersection is one when each of its members is.
 */
function objectShape(schema: unknown): Set<string> | undefined {
	if (!isRecord(schema)) return undefined;

	const members = (schema.anyOf ?? schema.oneOf ?? schema.allOf) as
		| unknown[]
		| undefined;
	if (Array.isArray(members) && members.length > 0) {
		const fields = new Set<string>();
		for (const member of members) {
			const shape = objectShape(member);
			if (!shape) return undefined;
			for (const field of shape) fields.add(field);
		}
		return fields;
	}

	if (schema.type !== 'object') return undefined;
	return new Set(
		isRecord(schema.properties) ? Object.keys(schema.properties) : [],
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string | number {
	return typeof value === 'string' || typeof value === 'number';
}
