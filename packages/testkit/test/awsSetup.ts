import { ensureServices } from './services';

/** The AWS emulator, on the gateway port its clients are pointed at. */
export default async function globalSetup() {
	await ensureServices('localstack');
}
