/**
 * WebSocket sink drivers, keyed by publisher-string scheme.
 *
 * The shape `@geekmidas/events` and `Encryption` use, for the same reason: a
 * surface's `<ID>_PUBLISHER_CONNECTION_STRING` names where its sockets are, and
 * the scheme picks what reaches them. `redis://` and `memory://` are the
 * process transport, built in. Any other scheme is a driver the entry point
 * registers — `apigateway:` on an AWS build, from
 * `@geekmidas/constructs/aws-websocket` — so a process that never publishes
 * to API Gateway never imports its SDK.
 *
 * Registration is an explicit call rather than an import side effect, because
 * a side-effecting module is exactly what a bundler is entitled to drop.
 */

import { API_GATEWAY_WEBSOCKET_SCHEME } from '@geekmidas/manifest';
import type { WebSocketSink } from './publisher';

/** What reaches a surface's sockets for one publisher-string scheme. */
export interface WebSocketSinkDriver {
	/** The scheme it handles, with its colon: `'apigateway:'`. */
	readonly scheme: string;
	/** The sink for a publisher string of that scheme. */
	sink(connectionString: string): WebSocketSink;
}

/**
 * The registry lives on `globalThis`, so one registration is seen by every
 * copy of this module — the ESM and the CJS build of one install.
 */
const REGISTRY = Symbol.for('@geekmidas/constructs/websocket-sinks');

function drivers(): Map<string, WebSocketSinkDriver> {
	const global = globalThis as {
		[REGISTRY]?: Map<string, WebSocketSinkDriver>;
	};
	global[REGISTRY] ??= new Map();
	return global[REGISTRY];
}

/** Make a sink available for its scheme. Idempotent. */
export function registerWebSocketSinkDriver(driver: WebSocketSinkDriver): void {
	drivers().set(driver.scheme, driver);
}

/** The driver registered for a publisher string's scheme, if any. */
export function webSocketSinkDriverFor(
	connectionString: string,
): WebSocketSinkDriver | undefined {
	return drivers().get(schemeOf(connectionString));
}

/** `apigateway:` from `apigateway://…`. */
export function schemeOf(connectionString: string): string {
	const separator = connectionString.indexOf(':');
	return separator === -1
		? connectionString
		: connectionString.slice(0, separator + 1);
}

/**
 * A surface's publisher string names a scheme this process registered no
 * sink for — `apigateway:` in an entry not built for AWS.
 */
export class UnregisteredWebSocketScheme extends Error {
	constructor(
		readonly surface: string,
		readonly scheme: string,
	) {
		super(
			`${surface}'s publisher string is a '${scheme}' URL, and this build registered no sink for it. ` +
				(scheme === API_GATEWAY_WEBSOCKET_SCHEME
					? "An API Gateway surface is an AWS target's: build for it (gkm build --provider aws), which registers the API Gateway sink and needs @aws-sdk/client-apigatewaymanagementapi, @aws-sdk/client-dynamodb and electrodb installed."
					: 'Register its driver with registerWebSocketSinkDriver before the first publish.'),
		);
		this.name = 'UnregisteredWebSocketScheme';
	}
}
