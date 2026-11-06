import { EnvironmentParser } from '@geekmidas/envkit';
import { registerStorageDriver } from '@geekmidas/storage';
import { beforeAll, describe, expect, it } from 'vitest';
import { MobileApp } from '../mobile-app';
import { ObjectStorage, ObjectStorageReadOnly } from '../object-storage';
import { StaticSite } from '../site';

/** A driver that records the URL it was built from and nothing else. */
const fakeDriver = {
	scheme: 'fake:',
	create: (url: string) =>
		({
			url,
			getDownloadURL: async (file: { path: string }) =>
				`fake-signed:${file.path}`,
		}) as never,
};

beforeAll(() => registerStorageDriver(fakeDriver));

const documents = new ObjectStorage('Documents');

const register = (env: Record<string, string>) =>
	documents.service.register({
		envParser: new EnvironmentParser(env),
	} as never);

describe("a site's and an app's edges to a bucket", () => {
	it('is a plain edge, without asking for the server half', () => {
		const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
			documents,
		]);
		const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([
			documents,
		]);

		const edge = { target: 'Documents', kind: 'objects' };
		expect(web.declare()[0]).toMatchObject({ dependencies: [edge] });
		expect(app.declare()[0]).toMatchObject({ dependencies: [edge] });
		const [declared] = web.declare() as [{ dependencies: object[] }];
		expect(declared.dependencies[0]).not.toHaveProperty('server');
	});

	it('asks for the server half through .server', () => {
		const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
			documents.server,
		]);
		const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([
			documents.server,
		]);

		expect(documents.server.id).toBe('Documents');
		expect(documents.server.declare()).toEqual(documents.declare());
		const edge = { target: 'Documents', kind: 'objects', server: true };
		expect(web.declare()[0]).toMatchObject({ dependencies: [edge] });
		expect(app.declare()[0]).toMatchObject({ dependencies: [edge] });
	});
});

describe('a bucket client with no connection', () => {
	const signedOnly = () =>
		register({
			DOCUMENTS_SIGNED_ORIGIN: 'https://documents.s3.eu-west-1.amazonaws.com',
		});

	it('refuses every method, naming .server', async () => {
		const client = await signedOnly();

		expect(() =>
			client.getUploadURL({ path: 'a.pdf', contentType: 'application/pdf' }),
		).toThrow(ObjectStorageReadOnly);
		await expect(async () =>
			client.getDownloadURL({ path: 'a.pdf' }),
		).rejects.toThrow(/documents\.server/);
	});

	it('says which bucket, which method and which key', async () => {
		const client = await signedOnly();

		let refused: unknown;
		try {
			await client.getVersions('a.pdf');
		} catch (error) {
			refused = error;
		}

		expect(refused).toBeInstanceOf(ObjectStorageReadOnly);
		expect(refused).toMatchObject({
			id: 'Documents',
			method: 'getVersions',
			key: 'DOCUMENTS_CONNECTION_STRING',
		});
	});

	it('is not mistaken for a promise', async () => {
		const client = await signedOnly();
		expect((client as { then?: unknown }).then).toBeUndefined();
	});

	it('connects where the connection is', async () => {
		const client = await register({
			DOCUMENTS_CONNECTION_STRING: 'fake://documents',
		});

		expect(await client.getDownloadURL({ path: 'a.pdf' })).toBe(
			'fake-signed:a.pdf',
		);
	});
});
