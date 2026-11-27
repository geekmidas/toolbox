import { EndpointFactory } from './EndpointFactory';

// What a surface's generated CORS asks of each request's `Origin`: an exact
// origin, or one label in place of a wildcard site's `*`.
export { trustsOrigin } from '@geekmidas/manifest';
export { publishConstructEvents } from '../publisher';
export {
	type Authorizer,
	AuthorizerNotAvailable,
	type AuthorizerOptions,
	type AuthorizerRequirement,
	BUILT_IN_SECURITY_SCHEMES,
	type BuiltInSecuritySchemeId,
	createAuthorizer,
	getSecurityScheme,
	isBuiltInSecurityScheme,
	NoAuthorizersGiven,
	type OAuthFlow,
	type OAuthFlows,
	oauth2AuthorizationCode,
	oauth2ClientCredentials,
	type SecurityRequirement,
	type SecurityScheme,
} from './Authorizer';
export type { ActorExtractor, MappedAudit } from './audit';
export {
	CallbackDeclaredTwice,
	type EndpointCallback,
	type EndpointCallbackResponse,
} from './callbacks';
export {
	type ConvertRouteParams,
	Endpoint,
	type EndpointContext,
	type EndpointHandler,
	type EndpointOutput,
	type EndpointSchemas,
	type EndpointStatus,
	type EndpointTag,
	type OperationExtensions,
	RedirectStatus,
	ResponseBuilder,
	SuccessStatus,
} from './Endpoint';
export {
	EndpointBuilder,
	NotAnExtension,
	UploadEndpointBuilder,
	type UploadHandler,
} from './EndpointBuilder';
export { EndpointFactory } from './EndpointFactory';
export {
	createApiGatewayCookies,
	createApiGatewayHeaders,
	createHonoCookies,
	createHonoHeaders,
	createNoopCookies,
	createNoopHeaders,
} from './lazyAccessors';
export {
	answersProblems,
	documentedErrors,
	type EndpointError,
	type EndpointErrorOptions,
	type ErrorFormat,
	type ErrorStatus,
	ErrorStatusNotARefusal,
	PROBLEM_CONTENT_TYPE,
	PROBLEM_SCHEMA_ID,
	type Problem,
	VALIDATION_FAILED,
} from './problems';
export {
	MalformedRequestBody,
	type RequestBodySource,
	readRequestBody,
	SUPPORTED_BODY_TYPES,
	UnsupportedRequestContentType,
} from './readRequestBody';
export {
	type BinaryBody,
	type BinarySchema,
	binary,
	type ContentMapOf,
	type DeclaredResponse,
	type DeclaredResponses,
	type DeclaredResponsesOf,
	type DefaultSchemaOf,
	isBinarySchema,
	type ResponseContent,
	type ResponseOptions,
	UndeclaredResponseContentType,
	type WithResponse,
} from './responses';
export {
	RLS_BYPASS,
	type RlsBypass,
	type RlsConfig,
	type RlsContext,
	type RlsContextExtractor,
} from './rls';
export {
	NoAuthenticator,
	type SessionAuth,
} from './sessionAuth';
export { defaultEnvParser, envParserFor } from './surfaceEnv';
export {
	UPLOAD_POST_SCHEMA,
	UploadAcceptInvalid,
	UploadContentTypeRefused,
	UploadContentTypeUnresolved,
	UploadExpiryInvalid,
	UploadMaxSizeInvalid,
	type UploadOptions,
	type UploadPost,
} from './upload';
export {
	type Webhook,
	WebhookEventDeclaredTwice,
	WebhookEventNotOnTopic,
	type WebhookOptions,
	type WebhookSignature,
	webhooksOf,
} from './webhooks';
