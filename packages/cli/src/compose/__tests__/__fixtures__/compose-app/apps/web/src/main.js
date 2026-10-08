// The client gkm generates from the API's endpoints — in the site's image,
// before `vite build` — at the workspace root's `.gkm/client/api.ts`.
import { createApi } from '@app/client/api';

// Inlined when the image is built: the stage's public addresses.
const config = {
	api: import.meta.env.VITE_API_URL,
	auth: import.meta.env.VITE_AUTH_URL,
};

const app = document.querySelector('#app');
if (app) app.textContent = JSON.stringify(config);

// Every route this page calls is public. Trace context on, said here: a
// page view's trace id goes to the API on every request, so the API's span
// continues the page's trace.
const api = createApi({
	baseURL: config.api,
	authStrategies: {},
	telemetry: true,
});

const ping = document.querySelector('#ping');
api('GET /ping').then(
	(body) => {
		if (ping) ping.textContent = JSON.stringify(body);
	},
	(error) => {
		if (ping) ping.textContent = `failed: ${error?.status ?? error}`;
	},
);
