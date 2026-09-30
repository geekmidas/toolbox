/**
 * What a migration file is called: a UTC timestamp, then a name.
 *
 * Kept apart from the commands so the scaffold can name the migration it
 * writes the same way `gkm migration` does, without loading a migrator.
 */

/** UTC `YYYYMMDDHHmmss` — sorts as text, and reads as a date. */
export function stamp(now = new Date()): string {
	return now
		.toISOString()
		.replace(/\.\d+Z$/, '')
		.replace(/\D/g, '');
}

/** `Add workouts` → `add_workouts`: the part of a file name after its stamp. */
export function slug(name: string): string {
	return name
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}
