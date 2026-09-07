/**
 * What this page is for: showing that the URLs arrived.
 *
 * Neither value is written down anywhere. `NEXT_PUBLIC_API_URL` and
 * `NEXT_PUBLIC_AUTH_URL` are inlined at build time from the edges the `Admin`
 * site declared — `.dependsOn([api, auth])` — and the same edge is why this
 * origin is on the API's CORS list and the auth server's trusted origins.
 *
 * `NEXT_PUBLIC_` rather than `VITE_` is the point: one neutral name from the
 * construct, one serialisation per framework.
 */
export default function Home() {
	const api = process.env.NEXT_PUBLIC_API_URL ?? '(not injected)';
	const auth = process.env.NEXT_PUBLIC_AUTH_URL ?? '(not injected)';

	return (
		<main style={{ padding: '4rem', lineHeight: 1.6 }}>
			<h1 style={{ marginBottom: '0.5rem' }}>kitchen-sink admin</h1>
			<p style={{ color: '#8b98ac', marginTop: 0 }}>
				The Next variant. Vite serves the root domain; this serves{' '}
				<code>admin.</code>
			</p>

			<dl style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>
				<dt style={{ color: '#8b98ac' }}>NEXT_PUBLIC_API_URL</dt>
				<dd style={{ margin: '0 0 1rem' }}>{api}</dd>
				<dt style={{ color: '#8b98ac' }}>NEXT_PUBLIC_AUTH_URL</dt>
				<dd style={{ margin: 0 }}>{auth}</dd>
			</dl>
		</main>
	);
}
