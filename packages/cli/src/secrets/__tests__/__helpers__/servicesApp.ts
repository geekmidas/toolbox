import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeComposeApp } from '../../../compose/__tests__/__helpers__/composeApp';

/**
 * The compose fixture — an API, an auth server and a site — with every kind
 * of construct a stage must be given keys for: a bucket served by a file
 * server, mail, a third-party API whose credentials have a schema, and a
 * `Credential` that nothing reads.
 */
export function writeServicesApp(dir: string): void {
	writeComposeApp(dir);
	writeFileSync(
		join(dir, 'constructs', 'services.ts'),
		`import { Credential } from '@geekmidas/constructs/credential';
import { Email } from '@geekmidas/constructs/email';
import { ExternalApi } from '@geekmidas/constructs/external-api';
import { FileServer } from '@geekmidas/constructs/file-server';
import { z } from 'zod';

export const uploads = new FileServer('Uploads');
export const mail = new Email('Mail', { templates: {} });
export const shipping = new ExternalApi('Shipping', {
  url: 'https://api.carrier.example',
  credentials: z.object({
    apiKey: z.string().startsWith('sk_'),
    accountId: z.string(),
    sandbox: z.boolean().optional(),
  }),
  client: () => ({}),
});
/** Declared, and read by no app: nothing asks the stage for it. */
export const payments = new Credential('Payments', {
  schema: z.object({ secretKey: z.string() }),
});
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'endpoints', 'ship.ts'),
		`import { api } from '../../../constructs/api.js';
import { mail, shipping, uploads } from '../../../constructs/services.js';

export const ship = api
  .post('/ship')
  .dependsOn([uploads, mail, shipping])
  .handle(async () => ({ ok: true }));
`,
	);
}
