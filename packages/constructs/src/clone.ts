/**
 * Cloning a builder, without enumerating its fields.
 *
 * The builders were mutable singletons that reset themselves by listing every
 * field at the end of `.handle()`. Two things followed from that, and both were
 * real:
 *
 * A configured base could not be reused. `const fn = f.logger(log)` handed back
 * `f` itself, and the first `.handle()` reset `_logger` to the default — so the
 * second handler built from that base silently logged somewhere else. Every
 * field in the reset block behaved the same way, which made
 * `f.logger(l).timeout(60_000)` a base that worked exactly once.
 *
 * And a field left out of the reset list leaked into the next handler instead.
 * `_constructs` was left out, so a function was granted a bucket a *previous*
 * function had declared — an over-grant in the field a deploy reads to size an
 * IAM policy.
 *
 * Both are the same defect: a hand-maintained list of fields that has to be
 * edited every time a field is added, and is silent when it isn't. So this
 * copies whatever the instance actually has, and the list stops existing. The
 * prototype is carried over, so `instanceof` and every method still resolve,
 * and the constructor is deliberately not re-run — this copies state rather
 * than initialising it.
 *
 * Fields must be replaced rather than mutated in place: a clone and its parent
 * share whatever array a field points at, so `_events.push(…)` would be seen by
 * both. Every builder assigns a fresh array instead, which is what makes
 * sharing the reference safe.
 */
export function cloneWith<T extends object>(
	instance: T,
	delta: Record<string, unknown>,
): T {
	const next = Object.create(Object.getPrototypeOf(instance)) as T;

	return Object.assign(next, instance, delta);
}
