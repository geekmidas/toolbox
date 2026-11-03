/**
 * The AWS adaptor for a `WebSocketApi`: a Lambda per API Gateway route, the
 * DynamoDB connection table and the management-API sink. It imports the AWS
 * SDK clients it is built on, so only a surface served from API Gateway
 * needs them.
 */
export {
	AmazonApiGatewayWebSocket,
	type AmazonApiGatewayWebSocketOptions,
	ApiGatewaySink,
	type ApiGatewayWebSocketEvent,
	type ApiGatewayWebSocketResult,
	apiGatewayFromConnectionString,
	apiGatewayWebSocketDriver,
	CONNECTION_TTL_SECONDS,
	type ConnectionTable,
	DynamoConnectionTable,
	WebSocketPublisherNotConfigured,
} from '../websocket/apigateway';
