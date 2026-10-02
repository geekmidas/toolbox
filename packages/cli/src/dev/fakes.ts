/**
 * External APIs' app fakes, served for `gkm dev`.
 *
 * An image fake runs with the other containers. An app fake is a fetch handler
 * in `test/fakes/<id>.ts`, and nothing runs it unless this does: each one
 * listens on the port its key was allocated, which is the port the stage's
 * `<ID>_URL` already names.
 */

import { pathToFileURL } from 'node:url';
import type { Fake } from '@geekmidas/constructs/external-api';
import { type ServerType, serve } from '@hono/node-server';
import { fakeKey } from '../reconcile/containers.js';
import type { LocalFake } from '../reconcile/fakes.js';
import type { PortAssignments } from '../reconcile/ports.js';

/** One app fake, listening. */
export interface ServedFake {
	id: string;
	port: number;
	server: ServerType;
}

/**
 * Serve every app fake on its allocated port. Image fakes are skipped — their
 * containers are already up.
 */
export async function serveFakes(
	fakes: Readonly<Record<string, LocalFake>>,
	ports: PortAssignments,
): Promise<ServedFake[]> {
	const served: ServedFake[] = [];

	for (const [id, local] of Object.entries(fakes)) {
		if (local.image) continue;

		const port = ports[fakeKey(id)];
		if (port === undefined) continue;

		// Read by `readFakes` already, so the module is known to be a fake.
		const module = (await import(pathToFileURL(local.file).href)) as {
			default: Extract<Fake, { kind: 'app' }>;
		};
		const { handler } = module.default;
		const server = serve({ fetch: (request) => handler.fetch(request), port });
		served.push({ id, port, server });
	}

	return served;
}

/** Stop every served fake. */
export function closeFakes(served: readonly ServedFake[]): void {
	for (const { server } of served) server.close();
}
