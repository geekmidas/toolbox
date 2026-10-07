import { ensureServices } from './services';

/** MinIO, the S3-compatible server the storage suites talk to. */
export default async function globalSetup() {
	await ensureServices('minio');
}
