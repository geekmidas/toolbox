import { ExternalApi } from '@geekmidas/constructs/external-api';
import { z } from 'zod';

export const carrier = new ExternalApi('Carrier', {
	url: 'https://api.carrier.example',
	credentials: z.object({ key: z.string() }),
	client: ({ url }) => ({ url }),
});
