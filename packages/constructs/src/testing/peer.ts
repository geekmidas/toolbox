/**
 * The TCP peer a test's in-process requests arrive from.
 *
 * A feature test hands a request straight to a surface's Hono app — no
 * socket, no server — so the app's bindings have no peer to read. Deployed,
 * every request has one, and what a surface trusts follows from it: the auth
 * server honours `x-gkm-client-ip` only from an internal caller, a loopback
 * or private peer with no `Origin` and no forwarding header. With no peer at
 * all the header was dropped, and every test's session check became the same
 * client to Better Auth's rate limiter.
 *
 * So an in-process dispatch says where it came from, the way
 * `@hono/node-server` does: its bindings carry `incoming.socket.remoteAddress`.
 * The address is loopback because that is the truth — the request came from
 * this process. A browser's own address still travels in its
 * `x-forwarded-for`, which makes it outside traffic exactly as it would be
 * behind the stack's proxy.
 *
 * Only a test's dispatch passes these. A runtime with no socket of its own
 * (Lambda, Bun) still has no peer, and a request with no peer is still not an
 * internal caller's.
 */

/** The address an in-process request presents as its peer. */
export const IN_PROCESS_PEER_ADDRESS = '127.0.0.1';

/** The part of `@hono/node-server`'s bindings a surface reads its peer from. */
export interface InProcessBindings {
	incoming: { socket: { remoteAddress: string } };
}

/** Bindings for `app.fetch(request, bindings)` from inside this process. */
export function inProcessBindings(): InProcessBindings {
	return { incoming: { socket: { remoteAddress: IN_PROCESS_PEER_ADDRESS } } };
}
