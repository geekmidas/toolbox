import type { ConstructManifest, SiteDeclaration } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { publicBuildValues } from '../siteBuild';

const manifest = {
	Assets: {
		kind: 'objects',
		id: 'Assets',
		provides: ['ASSETS_CONNECTION_STRING'],
	},
	AssetsServer: {
		kind: 'file-server',
		id: 'AssetsServer',
		of: 'Assets',
		provides: ['ASSETS_URL'],
	},
	Api: {
		kind: 'rest-api',
		id: 'Api',
		endpoints: [],
		provides: ['API_URL'],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'next',
		app: { path: 'apps/web' },
		dependencies: [
			{ target: 'Api', kind: 'rest-api' },
			{ target: 'AssetsServer', kind: 'file-server' },
		],
		provides: ['WEB_URL'],
	},
} as unknown as ConstructManifest;

/** What a deployed stage resolves: its secrets, as the provider wrote them. */
const stage: Record<string, string> = {
	WEB_URL: 'https://example.com',
	API_URL: 'https://api.example.com',
	ASSETS_URL: 'https://assets.example.com',
	ASSETS_CONNECTION_STRING: 's3://KEY:SECRET@acme-assets-x1?region=eu-west-1',
};

describe("a Next site's build, showing a file server's objects", () => {
	const args = publicBuildValues(
		manifest.Web as SiteDeclaration,
		manifest,
		(key) => stage[key],
		{},
	);

	it("is built with the server's address and where the bucket signs links", () => {
		expect(args.NEXT_PUBLIC_ASSETS_URL).toBe('https://assets.example.com');
		expect(args.NEXT_PUBLIC_ASSETS_SIGNED_ORIGIN).toBe(
			'https://acme-assets-x1.s3.eu-west-1.amazonaws.com',
		);
	});

	it('lists both as the origins its images load from, and not its API', () => {
		expect(args.NEXT_PUBLIC_GKM_IMAGE_ORIGINS).toBe(
			'https://acme-assets-x1.s3.eu-west-1.amazonaws.com,https://assets.example.com',
		);
	});

	it('is handed nothing of the bucket that writes', () => {
		expect(JSON.stringify(args)).not.toContain('SECRET');
		expect(args).not.toHaveProperty('NEXT_PUBLIC_ASSETS_CONNECTION_STRING');
	});
});
