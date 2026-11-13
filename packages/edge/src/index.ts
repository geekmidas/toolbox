/**
 * The edge in front of a gkm stack: what it routes (`/routes`), the reverse
 * proxies that serve it (`/proxy/*`), where its certificates come from
 * (`/certificates/*`) and the DNS providers its hosts are written through
 * (`/dns`, `/dns/*`).
 *
 * Its own package rather than part of the CLI because the CLI is not its only
 * reader: anything that changes the edge while a stack runs uses it too.
 */

export { composeLiteral } from './compose';
export { EdgeError, isEdgeError } from './errors';
