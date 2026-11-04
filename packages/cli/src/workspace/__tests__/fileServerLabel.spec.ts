import { describe, expect, it } from 'vitest';
import { fileServerLabel } from '../fileServerLabel';

describe("a file server's own name", () => {
	it('is the construct it was declared as, not its surface node', () => {
		expect(fileServerLabel('AssetsServer')).toBe('assets');
	});

	it('is kebab-cased like every other label', () => {
		expect(fileServerLabel('UserUploadsServer')).toBe('user-uploads');
		expect(fileServerLabel('S3AssetsServer')).toBe('s3-assets');
	});

	it('strips one suffix only, so a construct named for a server keeps it', () => {
		expect(fileServerLabel('MediaServerServer')).toBe('media-server');
		expect(fileServerLabel('ServerServer')).toBe('server');
	});
});
