import { describe, expect, it } from 'vitest';
import {
	fillPattern,
	matchPattern,
	ProcessorParamMissing,
	ProcessorPatternInvalid,
	parsePattern,
} from '../pattern';

describe('a processor pattern', () => {
	it('is literal segments, then parameters, then the key', () => {
		const parsed = parsePattern('/pdf/:page/:dpi/*');

		expect(parsed.params).toEqual(['page', 'dpi']);
		expect(parsed.prefix).toBe('/pdf/');
	});

	it('routes on every literal segment before the first parameter', () => {
		expect(parsePattern('/media/i/:width/*').prefix).toBe('/media/i/');
		expect(parsePattern('/thumbs/*').prefix).toBe('/thumbs/');
	});

	it.each([
		['i/:width/*', 'does not start with /'],
		['/i/:width', 'does not end with /*'],
		['/:width/*', 'first segment is a parameter'],
		['/i//*', 'empty segment'],
		['/i/*/x/*', 'only its last segment may be *'],
		['/i/:w/:w/*', 'appears twice'],
		['/i/:1w/*', 'is not a parameter name'],
		['/i m/:w/*', 'escape'],
	])('refuses %s', (pattern, reason) => {
		expect(() => parsePattern(pattern)).toThrow(ProcessorPatternInvalid);
		expect(() => parsePattern(pattern)).toThrow(reason);
	});

	it('matches a path into its parameters and key, decoded', () => {
		const parsed = parsePattern('/i/:width/*');

		expect(matchPattern(parsed, '/i/256/avatars/a%20b.png')).toEqual({
			params: { width: '256' },
			key: 'avatars/a b.png',
		});
	});

	it('matches nothing without a key, off its prefix, or through ..', () => {
		const parsed = parsePattern('/i/:width/*');

		expect(matchPattern(parsed, '/i/256')).toBeUndefined();
		expect(matchPattern(parsed, '/i/256/')).toBeUndefined();
		expect(matchPattern(parsed, '/x/256/a.png')).toBeUndefined();
		expect(matchPattern(parsed, '/i/256/a/../b.png')).toBeUndefined();
		expect(matchPattern(parsed, '/i/256/a//b.png')).toBeUndefined();
		expect(matchPattern(parsed, '/i/%E0%A4%A/a.png')).toBeUndefined();
	});

	it('fills back into the path it matches', () => {
		const parsed = parsePattern('/i/:width/*');
		const path = fillPattern(parsed, { width: 256 }, 'avatars/a b.png');

		expect(path).toBe('/i/256/avatars/a%20b.png');
		expect(matchPattern(parsed, path)).toEqual({
			params: { width: '256' },
			key: 'avatars/a b.png',
		});
	});

	it('refuses to fill without a parameter', () => {
		expect(() => fillPattern(parsePattern('/i/:width/*'), {}, 'a.png')).toThrow(
			ProcessorParamMissing,
		);
	});
});
