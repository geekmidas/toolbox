/**
 * The environment parser an endpoint runs with.
 *
 * Three facts, in order:
 *
 * 1. An endpoint built from a surface carries whatever parser that surface was
 *    given. This is the whole point of `api.get()` — the handler already has
 *    the thing, so nothing has to be named in config and nothing has to be
 *    printed into generated code.
 * 2. A surface that named none gets this default, which is what every
 *    application's own `config/env.ts` was: `process.env` merged with the
 *    credentials `gkm dev`/`gkm exec` injected. It was boilerplate identical in
 *    every project, and mandatory, which is a poor combination.
 * 3. An endpoint with no surface at all — a test, an MSW handler — gets the
 *    same default. Nothing has to opt in.
 *
 * Named a parser only when it is genuinely different: a merged secret source, a
 * fixture, a parser that reads from somewhere other than the process.
 */

import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';
import type { EndpointSurface } from './Endpoint';

let fallback: EnvironmentParser<{}> | undefined;

/**
 * The default parser, built once.
 *
 * Once because `Credentials` resolves through `globalThis` and decryption is
 * not free, and because two parsers over the same environment are two caches of
 * the same answer.
 */
export function defaultEnvParser(): EnvironmentParser<{}> {
	if (!fallback) {
		fallback = new EnvironmentParser({ ...process.env, ...Credentials });
	}

	return fallback;
}

/** The parser for an endpoint, from its surface or the default. */
export function envParserFor(
	surface: EndpointSurface | undefined,
): EnvironmentParser<{}> {
	return (surface?.envParser as EnvironmentParser<{}>) ?? defaultEnvParser();
}
