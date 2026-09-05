/**
 * Reading the inbox the app actually sent to.
 *
 * Mailpit is a real SMTP server with a real HTTP API, so "did we send the mail"
 * is answered by asking the thing that received it rather than by asserting
 * that a mock was called. That difference is the whole reason the local target
 * runs a mailbox instead of a stub: a mock says the code called `send`, and
 * this says a message arrived, addressed to whom, with a link in it that works.
 *
 * The port is read from the ports the local target assigned, never fixed —
 * several projects run at once and the whole point of the assignment is that
 * nothing hard-codes the answer.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Message {
	ID: string;
	Subject: string;
	To: { Address: string }[];
}

let base: Promise<string> | undefined;

/** Where Mailpit's API answers, from the ports reconcile assigned. */
async function inboxUrl(): Promise<string> {
	base ??= readFile(resolve(appRoot, '.gkm/ports.json'), 'utf-8').then(
		(raw) => {
			const port = (JSON.parse(raw) as Record<string, number>)['mailpit-web'];

			if (!port) {
				throw new Error(
					'No mailpit-web port assigned. The mail construct implies the ' +
						'container, so this means reconcile has not run for this stage.',
				);
			}

			return `http://localhost:${port}`;
		},
	);

	return base;
}

/** Every message currently in the inbox, newest first. */
export async function messages(): Promise<Message[]> {
	const response = await fetch(`${await inboxUrl()}/api/v1/messages?limit=50`);
	const body = (await response.json()) as { messages?: Message[] };

	return body.messages ?? [];
}

/** The newest message to one address, or nothing yet. */
export async function messageTo(address: string): Promise<Message | undefined> {
	return (await messages()).find((m) =>
		m.To.some((to) => to.Address === address),
	);
}

/**
 * The link a recipient would click.
 *
 * Magic-link sign-in is the case: the link *is* the credential, so following
 * the one that was really delivered is the only way to test the path a person
 * takes.
 *
 * `href` attributes rather than any URL in the source, because a React Email
 * template opens with an XHTML doctype and the *first* URL in the body is
 * `w3.org/TR/xhtml1/...`. Following that gets a 404 that reads exactly like a
 * rejected token, which is a long way to go to find a bug in the test helper.
 *
 * The HTML is entity-encoded, so `&amp;` is undone — a URL with a literal
 * `&amp;` between its parameters silently loses every one after the first, and
 * that failure also looks like a rejected token.
 */
export async function linkIn(id: string): Promise<string> {
	const response = await fetch(`${await inboxUrl()}/api/v1/message/${id}`);
	const body = (await response.json()) as { HTML?: string; Text?: string };

	const hrefs = [
		...(body.HTML ?? '').matchAll(/href=["'](https?:\/\/[^"']+)["']/g),
	].map((m) => m[1] as string);

	// A plain-text part has no attributes to read, so fall back to bare URLs —
	// minus the namespace and doctype ones, which are never what was clicked.
	const bare = [...(body.Text ?? '').matchAll(/https?:\/\/[^\s"'<>)]+/g)]
		.map((m) => m[0])
		.filter((url) => !url.includes('w3.org'));

	const link = [...hrefs, ...bare][0];
	if (!link) throw new Error(`No link in message ${id}`);

	return link.replaceAll('&amp;', '&');
}

/** Empty the inbox, so a spec asserts on mail it caused. */
export async function clearInbox(): Promise<void> {
	await fetch(`${await inboxUrl()}/api/v1/messages`, { method: 'DELETE' });
}
