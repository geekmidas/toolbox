/**
 * Everything this page does is read addresses it was given.
 *
 * `VITE_API_URL` and `VITE_AUTH_URL` are inlined at build time by whatever
 * built this — `gkm dev` locally, the deploy target deployed — and both come
 * from the *edge* declared in `constructs/site.ts` rather than from a `.env`
 * per stage. Deleting that edge is what would make these undefined; nothing in
 * this app would have to change.
 */
const config = {
	apiUrl: import.meta.env.VITE_API_URL,
	authUrl: import.meta.env.VITE_AUTH_URL,
	filesUrl: import.meta.env.VITE_UPLOADS_SERVER_URL,
};

const app = document.querySelector('#app');

if (app) {
	app.innerHTML = `
		<h1>Kitchen Sink</h1>
		<p>Addresses this build was given, none of them written down here:</p>
		<dl>
			${Object.entries(config)
				.map(
					([key, value]) =>
						`<dt><code>${key}</code></dt><dd><code>${value ?? '— not set —'}</code></dd>`,
				)
				.join('')}
		</dl>
	`;
}

// A credential-bearing URL is deliberately absent above: `PUBLIC` decides what
// may be prefixed into a bundle, and a database URL never may. Asking for
// `VITE_KITCHEN_SINK_URL` here would resolve to undefined, by design.
export {};
