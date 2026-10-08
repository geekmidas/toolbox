import { createApi } from '@kitchen-sink/client/api';

/**
 * The API, through the client gkm generates from its endpoints.
 *
 * `@kitchen-sink/client/api` is the workspace root's `.gkm/client/api.ts`,
 * mapped by this app's tsconfig. Nothing copies it here: `gkm dev` and
 * `gkm build` write it on a developer's machine, and a site's image generates
 * it from the API's endpoints before `next build` runs — so the types this
 * page is checked against are the API's own, in every place it is built.
 *
 * The base URL is the edge the `Admin` site declared, inlined at build time.
 * Every route this page calls is public, so the `iam` scheme the API declares
 * for its other routes is never used here.
 */
export const api = createApi({
	baseURL: process.env.NEXT_PUBLIC_API_URL ?? '',
	authStrategies: { iam: { type: 'none' } },
});
