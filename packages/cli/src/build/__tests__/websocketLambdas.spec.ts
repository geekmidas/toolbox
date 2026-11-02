import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { WebSocketApiDeclaration } from '@geekmidas/manifest';
import { apiGatewayWebSocketUrl } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileNameOf, writeWebSocketLambdas } from '../websocketLambdas';

/**
 * The Lambdas `gkm build --provider aws` writes for a WebSocket surface,
 * imported and invoked the way Lambda does — through `tsx`, from a directory
 * that resolves `@geekmidas/constructs` as an app would.
 */
let root: string;

const declaration: WebSocketApiDeclaration = {
	kind: 'websocket-api',
	id: 'Realtime',
	path: '.',
	routes: [
		{
			id: 'Realtimechat.send',
			action: 'chat.send',
			handler: 'routes.ts#send',
			dependencies: [],
		},
		{
			id: 'Realtime$default',
			action: '$default',
			handler: 'routes.ts#fallback',
			dependencies: [],
		},
	],
	provides: [],
};

beforeAll(() => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	root = mkdtempSync(join(cache, 'gkm-ws-lambdas-'));
	writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
	writeFileSync(
		join(root, 'realtime.ts'),
		`import { WebSocketApi } from '@geekmidas/constructs/websocket-api';

export const realtime = new WebSocketApi('Realtime', { path: '.' });
`,
	);
	writeFileSync(
		join(root, 'routes.ts'),
		`import { realtime } from './realtime.js';

export const send = realtime.route('chat.send').handle(({ body }) => body);
export const fallback = realtime.route('$default').handle(() => 'what?');
`,
	);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

async function build() {
	return writeWebSocketLambdas({
		outputDir: join(root, '.gkm', 'aws'),
		appRoot: root,
		workspaceRoot: root,
		surface: {
			file: join(root, 'realtime.ts'),
			exportName: 'realtime',
			construct: undefined,
		},
		declaration,
	});
}

/** Import a generated handler and invoke it once, in a process of its own. */
function invoke(file: string, event: unknown, env: Record<string, string>) {
	const script = `const { handler } = await import(${JSON.stringify(file)});
process.stdout.write(JSON.stringify(await handler(${JSON.stringify(event)})));`;
	return new Promise<unknown>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			['--import', 'tsx', '--input-type=module', '-e', script],
			{ cwd: root, env: { ...process.env, ...env } },
		);
		let out = '';
		let err = '';
		child.stdout.on('data', (chunk) => {
			out += chunk;
		});
		child.stderr.on('data', (chunk) => {
			err += chunk;
		});
		child.once('exit', (code) =>
			code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)),
		);
	});
}

describe('writeWebSocketLambdas', { timeout: 60_000 }, () => {
	it('writes a Lambda per route, and the adaptor’s own $connect and $disconnect', async () => {
		const routes = await build();

		expect(routes).toEqual([
			{
				surface: 'Realtime',
				action: '$connect',
				handler: '.gkm/aws/websocket/connect.handler',
			},
			{
				surface: 'Realtime',
				action: '$disconnect',
				handler: '.gkm/aws/websocket/disconnect.handler',
			},
			{
				surface: 'Realtime',
				action: 'chat.send',
				handler: '.gkm/aws/websocket/route-chat_send.handler',
			},
			{
				surface: 'Realtime',
				action: '$default',
				handler: '.gkm/aws/websocket/default.handler',
			},
		]);
	});

	it('empties what an earlier build wrote, so a deleted route goes with it', async () => {
		mkdirSync(join(root, '.gkm', 'aws', 'websocket'), { recursive: true });
		writeFileSync(join(root, '.gkm', 'aws', 'websocket', 'route-gone.ts'), '');

		await build();

		expect(readdirSync(join(root, '.gkm', 'aws', 'websocket')).sort()).toEqual([
			'connect.ts',
			'default.ts',
			'disconnect.ts',
			'route-chat_send.ts',
		]);
	});

	it('writes a $connect that runs the surface’s Origin check', async () => {
		await build();
		const file = join(root, '.gkm', 'aws', 'websocket', 'connect.ts');
		expect(existsSync(file)).toBe(true);

		// Refused before the table is touched, so no AWS is needed to see it
		// answer as API Gateway's $connect does.
		const answer = await invoke(
			file,
			{
				requestContext: {
					connectionId: 'c1',
					eventType: 'CONNECT',
					routeKey: '$connect',
				},
				headers: { Origin: 'https://evil.example.com' },
			},
			{
				REALTIME_PUBLISHER_CONNECTION_STRING: apiGatewayWebSocketUrl({
					region: 'us-east-1',
					endpoint: 'https://abc.execute-api.us-east-1.amazonaws.com/test',
					table: 'connections',
				}),
				REALTIME_TRUSTED_ORIGINS: 'https://app.example.com',
			},
		);

		expect(answer).toEqual({ statusCode: 403, body: 'Forbidden' });
	});
});

describe('fileNameOf', () => {
	it('keeps one dot in a handler path, the one before its export', () => {
		expect(fileNameOf('chat.send')).toBe('route-chat_send');
	});

	it('gives no action a lifecycle route’s file', () => {
		expect(fileNameOf('connect')).toBe('route-connect');
		expect(fileNameOf('$connect')).toBe('connect');
	});
});
