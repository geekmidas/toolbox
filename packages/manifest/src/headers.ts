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
 * from incoming requests, and the auth server ignores it on any request that
 * is not an internal caller's, so it cannot be spoofed from outside.
 */
export const CLIENT_IP_HEADER = 'x-gkm-client-ip';
