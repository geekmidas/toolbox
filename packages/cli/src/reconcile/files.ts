import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Write a file only when its content would change, so mtimes stay meaningful. */
export async function write(
	path: string,
	content: string,
	mode?: number,
): Promise<void> {
	try {
		if ((await readFile(path, 'utf-8')) === content) {
			if (mode !== undefined) await chmod(path, mode);
			return;
		}
	} catch {
		// Absent or unreadable — write it.
	}

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, mode === undefined ? {} : { mode });
	if (mode !== undefined) await chmod(path, mode);
}
