import { FileServer } from '@geekmidas/constructs/file-server';

/**
 * The uploads bucket, and the domain that serves it.
 *
 * One construct declaring two nodes: `Uploads` (the bucket) and `UploadsServer`
 * (the surface over it). The bucket keeps the plain id deliberately — adding a
 * server to a bucket that already holds data has to be an edit that *adds* a
 * node, never one that renames the node holding it.
 *
 * Locally `UPLOADS_URL` is an `s3://` URL carrying MinIO's endpoint and
 * `UPLOADS_SERVER_URL` is where MinIO serves that bucket; deployed the same two
 * keys carry a real bucket and a real domain. The endpoint that presigns an
 * upload knows neither — the scheme in the URL picks the driver, and which
 * drivers exist is decided by the generated entry point (`gkm dev`'s server, or
 * the Lambda handler), never by application code.
 *
 * `open` is an exception list, and everything not on it needs a signature.
 * `brand/**` is served unsigned; `services.uploads.url('invoices/7.pdf')` does
 * not compile, and does not run either.
 *
 * Note what did *not* change when this stopped being an `ObjectStorage`:
 * `endpoints/uploads.ts` still calls `services.uploads.getUploadURL(...)` and
 * still type-checks. The serving client is a superset of the storage one, which
 * is the property that makes growing a serving half a non-event.
 */
export const uploads = new FileServer('Uploads', {
	open: ['brand/**'],
});
