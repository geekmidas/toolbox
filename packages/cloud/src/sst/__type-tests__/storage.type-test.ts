// Type-level check that Storage is a linkable usable in a Function's links.
// Checked by `ts:check:sst`; vitest ignores it.

import { App } from '../App';
import { Function } from '../Function';
import { Storage } from '../Storage';

const stack = new App({
	name: 'a',
	stage: 'dev',
	domain: 'example.com',
	hostedZoneId: 'Z',
	region: 'us-east-1',
}).stack('files');

const uploads = new Storage(stack, 'uploads');

// A Storage is a GkmLinkable, so it can be linked; `UPLOADS_NAME` is the env var
// its `Bucket` resolver yields and what `@geekmidas/storage` consumes.
export const upload = new Function(stack, 'Upload', {
	handler: 'upload.handler',
	links: [uploads],
	envVars: ['UPLOADS_NAME'],
});
