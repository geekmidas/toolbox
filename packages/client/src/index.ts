/**
 * The root export, which `package.json` has always declared and the build has
 * never produced — there was no `src/index.ts`, so `@geekmidas/client`
 * resolved to nothing.
 *
 * It carries the framework-free core. The hooks stay behind their own subpaths
 * (`/react-query`, `/endpoint-hooks`, `/openapi`) so that importing a fetcher
 * does not pull React and `@tanstack/react-query` in with it.
 */
export * from './auth-fetcher';
export * from './fetcher';
export * from './infer';
export * from './types';
