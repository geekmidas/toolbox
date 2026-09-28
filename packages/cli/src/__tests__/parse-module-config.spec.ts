import { describe, expect, it } from 'vitest';
import { parseModuleConfig } from '../config';

describe('parseModuleConfig', () => {
	it('imports the default export when no name is given', () => {
		expect(parseModuleConfig('./src/config/env', 'envParser')).toEqual({
			path: './src/config/env',
			importPattern: 'envParser',
		});
	});

	it('imports a named export under its own name', () => {
		expect(
			parseModuleConfig('./src/config/env#envParser', 'envParser'),
		).toEqual({ path: './src/config/env', importPattern: '{ envParser }' });
	});

	it('aliases a named export to the name the generated code uses', () => {
		expect(parseModuleConfig('./src/config/env#myEnv', 'envParser')).toEqual({
			path: './src/config/env',
			importPattern: '{ myEnv as envParser }',
		});
	});
});
