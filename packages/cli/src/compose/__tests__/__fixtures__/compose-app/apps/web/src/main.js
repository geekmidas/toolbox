// Inlined when the image is built: the stage's public addresses.
const config = {
	api: import.meta.env.VITE_API_URL,
	auth: import.meta.env.VITE_AUTH_URL,
};

const app = document.querySelector('#app');
if (app) app.textContent = JSON.stringify(config);
