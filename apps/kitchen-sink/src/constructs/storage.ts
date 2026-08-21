import { ObjectStorage } from '@geekmidas/constructs/object-storage';

/**
 * The uploads bucket.
 *
 * Locally `UPLOADS_URL` is an `s3://` URL carrying MinIO's endpoint; deployed
 * the same key carries a real bucket in a real region. The endpoint that
 * presigns an upload knows neither — the scheme in the URL picks the driver, and
 * which drivers exist is decided by the generated entry point (`gkm dev`'s
 * server, or the Lambda handler), never by application code.
 */
export const uploads = new ObjectStorage('Uploads');
