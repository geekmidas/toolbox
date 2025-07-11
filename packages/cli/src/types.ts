export type Provider = 'server' | 'aws-apigatewayv1' | 'aws-apigatewayv2';

export type Routes = string | string[];

export interface GkmConfig {
  routes: Routes;
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
