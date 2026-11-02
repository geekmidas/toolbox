/**
 * Headers gkm reserves for its own services' calls to each other.
 *
 * Shared by `@geekmidas/constructs`, which sends and reads them, and
 * `@geekmidas/cli`, whose edges strip them from every request that arrives
 * from outside — so the two cannot name them differently.
 */

/**
 * The address of the client a service-to-service call is made on behalf of.
 *
 * An API asking its auth server for a session sends the client's address in
 * this rather than `X-Forwarded-For`: a forwarding header marks a request as
 * outside traffic, which would start the auth server's span in a new trace,
 * and the address is still needed — Better Auth rate-limits per client.
 *
 * Reserved: the stack's edge (Caddy, Traefik, the `gkm dev` edge) removes it
 * from every request that does not carry the stack's token
 * ({@link EDGE_TOKEN_HEADER}), and the auth server ignores it on any request
 * that neither carries the token nor is an internal caller's, so it cannot be
 * spoofed from outside.
 */
export const CLIENT_IP_HEADER = 'x-gkm-client-ip';

/**
 * The token a service of a stack sends beside {@link CLIENT_IP_HEADER} when
 * it calls a sibling through the stack's edge, at its public address.
 *
 * A request carries a forwarding header once it has passed an edge, so the
 * peer alone no longer says it came from inside the stack. The token does:
 * it is derived from the stage's seed, handed to every process of the stack
 * as {@link EDGE_TOKEN_KEY}, and known to the edge. The edge keeps
 * `x-gkm-client-ip` only on a request carrying it, and strips the header from
 * every other; the auth server honours the header only from an internal
 * caller or a request carrying its own token. A browser never has it.
 */
export const EDGE_TOKEN_HEADER = 'x-gkm-edge-token';

/** Where a stack's processes read the token {@link EDGE_TOKEN_HEADER} carries. */
export const EDGE_TOKEN_KEY = 'GKM_EDGE_TOKEN';
