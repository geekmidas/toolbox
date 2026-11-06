/**
 * Type-level tests for a bucket's server half.
 *
 * `.server` is what a site or a mobile app names for the connection and the
 * key pair. A backend's plain edge is already the full one, so `.server` must
 * not be something a backend's `.dependsOn()` accepts: it is a `Declarable`,
 * never a `Consumable`.
 *
 * Type-checked, never executed.
 */

import type { Consumable, Declarable } from '../construct-interface';
import type { FileServer } from '../file-server';
import type { ObjectStorage } from '../object-storage';

type Expect<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

/** A frontend can name either half. */
type _BucketServerDeclarable = Expect<
	Extends<ObjectStorage['server'], Declarable>
>;
type _FileServerServerDeclarable = Expect<
	Extends<FileServer['server'], Declarable>
>;

/** A backend cannot: neither server half carries a client to inject. */
type _BucketServerNotConsumable = Expect<
	Extends<Extends<ObjectStorage['server'], Consumable>, false>
>;
type _FileServerServerNotConsumable = Expect<
	Extends<Extends<FileServer['server'], Consumable>, false>
>;

/** The bucket itself is what a backend depends on. */
type _BucketConsumable = Expect<Extends<ObjectStorage, Consumable>>;
