/**
 * Pick an image, ask the API for a presigned PUT, send the bytes straight to
 * the bucket, then load the file back through the CDN.
 */
const apiUrl = import.meta.env.VITE_API_URL;

const form = document.querySelector<HTMLFormElement>('#upload');
const input = document.querySelector<HTMLInputElement>('#file');
const status = document.querySelector<HTMLParagraphElement>('#status');
const result = document.querySelector<HTMLDivElement>('#result');

function say(text: string) {
	if (status) status.textContent = text;
}

form?.addEventListener('submit', async (event) => {
	event.preventDefault();
	const file = input?.files?.[0];
	if (!file) return say('Pick an image first.');

	say('Asking for an upload URL…');
	const presign = await fetch(`${apiUrl}/uploads`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: file.name,
			contentType: file.type,
			contentLength: file.size,
		}),
	});
	if (!presign.ok) return say(`API refused: ${presign.status}`);
	const { uploadUrl, url } = (await presign.json()) as {
		uploadUrl: string;
		url: string;
	};

	say('Uploading…');
	const put = await fetch(uploadUrl, {
		method: 'PUT',
		headers: { 'content-type': file.type },
		body: file,
	});
	if (!put.ok) return say(`Bucket refused: ${put.status}`);

	say('Uploaded.');
	if (result) {
		result.innerHTML = '';
		const link = Object.assign(document.createElement('a'), {
			href: url,
			textContent: url,
		});
		const img = Object.assign(document.createElement('img'), { src: url });
		result.append(link, img);
	}
});
