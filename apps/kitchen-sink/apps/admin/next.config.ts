import type { NextConfig } from 'next';

/**
 * The admin half of kitchen-sink, and the second site variant.
 *
 * `Web` is Vite and this is Next, deliberately: the `site` declaration carries
 * a `variant`, and the deploy picks a different Dockerfile template from it.
 * Two variants is the only way that selection is proven rather than asserted.
 *
 * `output: 'standalone'` is what makes the image small — Next traces what the
 * server actually needs instead of shipping `node_modules`.
 *
 * Nothing here names a host. `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_AUTH_URL`
 * arrive as build args, resolved from the edges the construct declared.
 */
const config: NextConfig = {
	output: 'standalone',
};

export default config;
