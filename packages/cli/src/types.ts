export type Provider = 'server' | 'aws-apigatewayv1' | 'aws-apigatewayv2';

export interface GkmConfig {
  routes: string;
  envParser: string;
  logger: string;
}

export interface BuildOptions {
  provider: Provider;
}

export interface RouteInfo {
  path: string;
  method: string;
  handler: string;
}

export interface RoutesManifest {
  routes: RouteInfo[];
}
