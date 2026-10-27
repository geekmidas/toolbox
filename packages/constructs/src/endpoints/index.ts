import { EndpointFactory } from './EndpointFactory';

// What a surface's generated CORS asks of each request's `Origin`: an exact
// origin, or one label in place of a wildcard site's `*`.
export { trustsOrigin } from '@geekmidas/manifest';
export { publishConstructEvents } from '../publisher';
export {
	type Authorizer,
	BUILT_IN_SECURITY_SCHEMES,
	type BuiltInSecuritySchemeId,
	createAuthorizer,
	getSecurityScheme,
	isBuiltInSecurityScheme,
	type OAuthFlow,
	type OAuthFlows,
	type SecurityScheme,
} from './Authorizer';
export type { ActorExtractor, MappedAudit } from './audit';
export {
	type ConvertRouteParams,
	Endpoint,
	type EndpointContext,
	type EndpointHandler,
	type EndpointOutput,
	type EndpointSchemas,
	type EndpointStatus,
	RedirectStatus,
	ResponseBuilder,
	SuccessStatus,
} from './Endpoint';
export {
	EndpointBuilder,
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
	MalformedRequestBody,
	type RequestBodySource,
	readRequestBody,
	SUPPORTED_BODY_TYPES,
	UnsupportedRequestContentType,
} from './readRequestBody';
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
