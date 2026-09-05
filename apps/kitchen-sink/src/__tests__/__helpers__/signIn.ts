/**
 * Signing in the way a person does.
 *
 * The whole path, with nothing stood in for: ask for a magic link, read the
 * mail that really arrived in Mailpit, follow the link that was really in it,
 * and keep the cookie the auth server really set. No token is minted here and
 * no session row is inserted — which matters, because every one of those
 * shortcuts would still pass if the mail never sent, and sending *is* the login
 * path when the link is the credential.
 */

import { harness } from './app.js';
import { linkIn, messages } from './mailpit.js';

/** A signed-in identity: the cookie header, and who it belongs to. */
export interface SignedIn {
	cookie: string;
	userId: string;
	email: string;
}

export async function signIn(email: string): Promise<SignedIn> {
	const { request } = await harness();

	// What was already there, so the wait below can tell *this* link from a
	// previous one. A magic link is single-use, so picking up an older message
	// for the same address verifies a token that has already been spent — which
	// fails as a 404 and reads like a routing bug rather than a stale link.
	const before = new Set((await messages()).map((m) => m.ID));

	const requested = await request('/api/auth/sign-in/magic-link', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email }),
	});

	if (!requested.ok) {
		throw new Error(`Magic link request failed: ${requested.status}`);
	}

	// The mail is sent by the auth server through the mail construct, so this
	// waits on delivery rather than on the request that triggered it.
	const message = await waitForMail(email, before);
	const link = await linkIn(message.ID);

	// `redirect: 'manual'` because following it would land on the callback URL,
	// which is the frontend and is not running. The cookie is on this response.
	const verified = await request(link, { redirect: 'manual' });

	const cookie = setCookieHeader(verified);
	if (!cookie) {
		throw new Error(
			`No session cookie after verifying (status ${verified.status})`,
		);
	}

	const session = await request('/api/auth/get-session', {
		headers: { cookie },
	});
	const body = (await session.json()) as { user?: { id: string } } | null;

	if (!body?.user) throw new Error('Verified the link but hold no session');

	return { cookie, userId: body.user.id, email };
}

async function waitForMail(
	address: string,
	before: ReadonlySet<string>,
): Promise<{ ID: string }> {
	const deadline = Date.now() + 20_000;

	while (Date.now() < deadline) {
		const message = (await messages()).find(
			(m) => !before.has(m.ID) && m.To.some((to) => to.Address === address),
		);
		if (message) return message;

		await new Promise((r) => setTimeout(r, 200));
	}

	throw new Error(`No new sign-in mail arrived for ${address}`);
}

/**
 * The cookies from a response, as a header to send back.
 *
 * `getSetCookie` returns each one separately, and only the name=value pair
 * before the first `;` belongs in a request — sending the attributes back is a
 * header the server will not parse.
 */
function setCookieHeader(response: Response): string | undefined {
	const cookies = response.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.filter(Boolean);

	return cookies.length > 0 ? cookies.join('; ') : undefined;
}
