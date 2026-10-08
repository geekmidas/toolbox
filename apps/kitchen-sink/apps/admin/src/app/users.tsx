'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Users =
	| { state: 'loading' }
	| { state: 'ok'; names: string[] }
	| { state: 'failed'; message: string };

/**
 * The API's users, asked from the browser through the generated client.
 *
 * From the browser, because that is where a site meets its API: the request
 * is cross-origin, so it only succeeds when the `Admin` edge put this origin
 * on the API's CORS list — the same edge that inlined the URL it goes to.
 * The response is typed by the client, from the endpoint's own output schema.
 */
export function ApiUsers() {
	const [users, setUsers] = useState<Users>({ state: 'loading' });

	useEffect(() => {
		api('GET /users')
			.then(({ users }) =>
				setUsers({ state: 'ok', names: users.map((user) => user.name) }),
			)
			.catch((error: unknown) =>
				setUsers({
					state: 'failed',
					message: error instanceof Error ? error.message : String(error),
				}),
			);
	}, []);

	return (
		<section data-testid="api-users" data-state={users.state}>
			<h2 style={{ fontSize: 16 }}>Users, from the API</h2>
			{users.state === 'loading' ? (
				<p>Asking the API…</p>
			) : users.state === 'failed' ? (
				<p>API unreachable: {users.message}</p>
			) : (
				<ul>
					{users.names.map((name, index) => (
						// Names repeat, and the list is never reordered.
						<li key={index}>{name}</li>
					))}
				</ul>
			)}
		</section>
	);
}
