/**
 * Name derivation — the single source for turning a construct's id into the
 * names that appear elsewhere.
 *
 * These live here rather than in each consumer because `@geekmidas/constructs`
 * derives a key when it declares, and `@geekmidas/cloud` derives the same key
 * when it supplies the value. Two implementations of the same rule is precisely
 * the drift this design exists to remove.
 */

import snakecase from 'lodash.snakecase';

import { InvalidConstructId } from './errors';

/**
 * `UPPER_SNAKE_CASE`, with numbers kept against the word they follow.
 *
 * Matches `environmentCase` in `@geekmidas/envkit`, which reads the values these
 * names key. The two must agree exactly, so this is the implementation and that
 * one should defer to it.
 *
 * @example environmentCase('sendEmail') // 'SEND_EMAIL'
 * @example environmentCase('api2')      // 'API2'  (digit joins its word)
 */
export function environmentCase(name: string): string {
	return snakecase(name)
		.toUpperCase()
		.replace(/_\d+/g, (r) => r.replace('_', ''));
}

/**
 * The env key a construct provides for one of its roles.
 *
 * @example provideKey('Uploads', 'url')      // 'UPLOADS_URL'
 * @example provideKey('Uploads', 'cdnUrl')   // 'UPLOADS_CDN_URL'
 */
export function provideKey(id: string, role: string): string {
	return environmentCase(`${id}_${role}`);
}

/**
 * A construct's canonical id — PascalCase.
 *
 * `uploads`, `Uploads`, `user_uploads`, and `user-uploads` all canonicalise to
 * the same id, so declaring two of them is a duplicate rather than a collision
 * to detect.
 *
 * Runtime only. Writing the id in PascalCase is what keeps the *type* usable:
 * the service key is `Uncapitalize<TName>`, a TypeScript intrinsic, so no
 * type-level transform is needed and none has to be kept in step with this one.
 *
 * @example canonicalId('user-uploads') // 'UserUploads'
 */
export function canonicalId(input: string): string {
	// `upperFirst(camelCase(x))` by another route — snakecase is already a
	// dependency, and adding lodash.camelcase for the same result is not worth it.
	const id = snakecase(input)
		.split('_')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');

	if (!VALID_ID.test(id)) throw new InvalidConstructId(input, id);
	return id;
}

/**
 * A canonical id: PascalCase, letters and digits only.
 *
 * Narrower than a JavaScript identifier — `_id` and `$ref` are legal JavaScript
 * and rejected here — because the id also has to survive `environmentCase` into
 * an env key and `cloudName` into a DNS-safe resource name.
 */
const VALID_ID = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The physical name a target provisions a construct under — lowercase kebab,
 * scoped so two stages or apps sharing an account cannot collide.
 *
 * @example cloudName({ stage: 'prod', app: 'myapp' }, 'UserUploads')
 * //        'prod-myapp-user-uploads'
 */
export function cloudName(
	scope: { stage: string; app: string },
	id: string,
): string {
	return [scope.stage, scope.app, snakecase(id).replace(/_/g, '-')]
		.join('-')
		.toLowerCase();
}
