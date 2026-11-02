/**
 * The `apigateway://` string a `WebSocketApi`'s publisher reads on AWS.
 *
 * Here because two packages meet on it: `@geekmidas/cloud` composes it from
 * the API Gateway WebSocket API and the connection table it provisioned, and
 * `@geekmidas/constructs` parses it to reach them. One codec, so the two
 * cannot disagree about a parameter's name.
 *
 * On a server stage the same key is a `redis://` string — whichever replica
 * holds the socket delivers. On AWS the gateway holds every socket: a send is
 * a call to its management API, and a broadcast reads the ids it would fan out
 * to from the table.
 */

export const API_GATEWAY_WEBSOCKET_SCHEME = 'apigateway:';

export interface ApiGatewayWebSocketTarget {
	/** The region the API and its table are in. */
	region: string;
	/**
	 * The management API — `https://<api>.execute-api.<region>.amazonaws.com/<stage>`
	 * — that `postToConnection` and `deleteConnection` are called on.
	 */
	endpoint: string;
	/** The DynamoDB table its open connections are kept in. */
	table: string;
	/** DynamoDB's address, for an emulator; AWS's own when absent. */
	tableEndpoint?: string;
}

/**
 * `apigateway://<region>?endpoint=<management url>&table=<name>[&tableEndpoint=<url>]`
 */
export function apiGatewayWebSocketUrl(
	target: ApiGatewayWebSocketTarget,
): string {
	const query = new URLSearchParams({
		endpoint: target.endpoint,
		table: target.table,
		...(target.tableEndpoint ? { tableEndpoint: target.tableEndpoint } : {}),
	});
	return `${API_GATEWAY_WEBSOCKET_SCHEME}//${target.region}?${query}`;
}

/** An `apigateway://` string missing what a publisher needs to reach a socket. */
export class InvalidApiGatewayWebSocketUrl extends Error {
	constructor(
		/** Which part is missing: `region`, `endpoint` or `table`. */
		readonly missing: string,
	) {
		super(
			`An apigateway:// WebSocket publisher string needs its ${missing}. gkm composes it as <ID>_PUBLISHER_CONNECTION_STRING on an AWS stage — read it from there rather than writing one by hand.`,
		);
		this.name = 'InvalidApiGatewayWebSocketUrl';
	}
}

/** What an `apigateway://` string names. */
export function parseApiGatewayWebSocketUrl(
	value: string,
): ApiGatewayWebSocketTarget {
	const url = new URL(value);
	if (url.protocol !== API_GATEWAY_WEBSOCKET_SCHEME || !url.hostname) {
		throw new InvalidApiGatewayWebSocketUrl('region');
	}
	const endpoint = url.searchParams.get('endpoint');
	if (!endpoint) throw new InvalidApiGatewayWebSocketUrl('endpoint');
	const table = url.searchParams.get('table');
	if (!table) throw new InvalidApiGatewayWebSocketUrl('table');
	const tableEndpoint = url.searchParams.get('tableEndpoint');
	return {
		region: url.hostname,
		endpoint,
		table,
		...(tableEndpoint ? { tableEndpoint } : {}),
	};
}
