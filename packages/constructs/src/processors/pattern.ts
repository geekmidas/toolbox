/**
 * A processor's path pattern: literal segments, `:name` parameters, and a
 * final `*` that is the object's key.
 *
 * ```
 * /i/:width/*        →  /i/256/avatars/7.png   { width: '256' }, 'avatars/7.png'
 * /pdf/:page/:dpi/*  →  /pdf/1/150/doc.pdf     { page: '1', dpi: '150' }, 'doc.pdf'
 * ```
 *
 * It starts with a literal segment because the edge routes on that prefix: a
 * pattern beginning with a parameter would claim every path on the file
 * server, objects included.
 */

/** The parameter names a pattern declares, as a union. */
export type PatternParamNames<P extends string> =
	P extends `${string}/:${infer Name}/${infer Rest}`
		? Name | PatternParamNames<`/${Rest}`>
		: never;

/** The raw parameters a pattern matches, before its schema parses them. */
export type PatternParams<P extends string> = {
	[K in PatternParamNames<P>]: string;
};

/** A pattern a processor cannot be served on. */
export class ProcessorPatternInvalid extends Error {
	constructor(
		readonly pattern: string,
		readonly reason: string,
	) {
		super(
			`'${pattern}' is not a processor pattern: ${reason}. A pattern is a ` +
				`literal first segment, then any \`:name\` parameters, then \`*\` ` +
				`for the object's key — '/i/:width/*'.`,
		);
		this.name = 'ProcessorPatternInvalid';
	}
}

/** A pattern, parsed once. */
export interface ParsedPattern {
	readonly pattern: string;
	/** Each segment before the key: a literal, or a parameter's name. */
	readonly segments: readonly (
		| { kind: 'literal'; value: string }
		| { kind: 'param'; name: string }
	)[];
	/** The parameter names, in the order they appear. */
	readonly params: readonly string[];
	/** The literal path the edge routes on — `/i/`. */
	readonly prefix: string;
}

/** @throws {ProcessorPatternInvalid} */
export function parsePattern(pattern: string): ParsedPattern {
	if (!pattern.startsWith('/')) {
		throw new ProcessorPatternInvalid(pattern, 'it does not start with /');
	}
	if (!pattern.endsWith('/*')) {
		throw new ProcessorPatternInvalid(
			pattern,
			'it does not end with /* — the key',
		);
	}

	const parts = pattern.slice(1, -2).split('/');
	const segments: ParsedPattern['segments'][number][] = [];
	const params: string[] = [];
	for (const part of parts) {
		if (part === '') {
			throw new ProcessorPatternInvalid(pattern, 'it has an empty segment');
		}
		if (part.includes('*')) {
			throw new ProcessorPatternInvalid(
				pattern,
				'only its last segment may be *',
			);
		}
		if (part.startsWith(':')) {
			const name = part.slice(1);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
				throw new ProcessorPatternInvalid(
					pattern,
					`'${part}' is not a parameter name`,
				);
			}
			if (params.includes(name)) {
				throw new ProcessorPatternInvalid(pattern, `'${name}' appears twice`);
			}
			params.push(name);
			segments.push({ kind: 'param', name });
			continue;
		}
		if (!/^[A-Za-z0-9._~-]+$/.test(part)) {
			throw new ProcessorPatternInvalid(
				pattern,
				`'${part}' has characters a path segment would escape`,
			);
		}
		segments.push({ kind: 'literal', value: part });
	}

	const first = segments[0];
	if (!first || first.kind !== 'literal') {
		throw new ProcessorPatternInvalid(
			pattern,
			'its first segment is a parameter, which would claim every path',
		);
	}

	const literals: string[] = [];
	for (const segment of segments) {
		if (segment.kind !== 'literal') break;
		literals.push(segment.value);
	}

	return { pattern, segments, params, prefix: `/${literals.join('/')}/` };
}

/** A path the pattern matched: its raw parameters and the key. */
export interface PatternMatch {
	params: Record<string, string>;
	key: string;
}

/**
 * Match a request path, decoding each parameter and each key segment. A path
 * with an empty key, or one that decodes to a `..` segment, matches nothing.
 */
export function matchPattern(
	parsed: ParsedPattern,
	path: string,
): PatternMatch | undefined {
	const parts = path.replace(/^\/+/, '').split('/');
	if (parts.length <= parsed.segments.length) return undefined;

	const params: Record<string, string> = {};
	for (const [index, segment] of parsed.segments.entries()) {
		const part = decode(parts[index] ?? '');
		if (part === undefined || part === '') return undefined;
		if (segment.kind === 'literal') {
			if (part !== segment.value) return undefined;
			continue;
		}
		params[segment.name] = part;
	}

	const keyParts = parts.slice(parsed.segments.length).map(decode);
	if (keyParts.some((part) => part === undefined || part === '..')) {
		return undefined;
	}
	const key = keyParts.join('/');
	if (key === '' || keyParts.includes('')) return undefined;

	return { params, key };
}

/** The path that addresses `key` through the pattern with these parameters. */
export function fillPattern(
	parsed: ParsedPattern,
	params: Readonly<Record<string, string | number>>,
	key: string,
): string {
	const head = parsed.segments.map((segment) => {
		if (segment.kind === 'literal') return segment.value;
		const value = params[segment.name];
		if (value === undefined || `${value}` === '') {
			throw new ProcessorParamMissing(parsed.pattern, segment.name);
		}
		return encodeURIComponent(`${value}`);
	});
	const tail = key
		.replace(/^\/+/, '')
		.split('/')
		.map((part) => encodeURIComponent(part));

	return `/${[...head, ...tail].join('/')}`;
}

/** A processed URL was asked for without one of the pattern's parameters. */
export class ProcessorParamMissing extends Error {
	constructor(
		readonly pattern: string,
		readonly param: string,
	) {
		super(
			`'${pattern}' needs '${param}' to address an object, and it was not given.`,
		);
		this.name = 'ProcessorParamMissing';
	}
}

function decode(part: string): string | undefined {
	try {
		return decodeURIComponent(part);
	} catch {
		return undefined;
	}
}
