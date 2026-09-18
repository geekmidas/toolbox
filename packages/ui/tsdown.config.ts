import { defineConfig } from 'tsdown';

/**
 * Every subpath `package.json` exports needs an entry here, and the entry has
 * to name a file that exists — tsdown drops one that does not, silently, and
 * the export then resolves to nothing. Four of these named `src/layout`,
 * `src/data-display`, `src/feedback` and a `src/primitives` that was never
 * written, when the components live under `src/components/`.
 *
 * The emitted path mirrors the source path, which is what the `exports` map
 * points at.
 */
export default defineConfig({
	entry: [
		'src/index.ts',
		'src/components/ui/index.ts',
		'src/components/layout/index.ts',
		'src/components/data-display/index.ts',
		'src/components/feedback/index.ts',
		'src/hooks/index.ts',
		'src/lib/utils.ts',
		'src/styles/theme.ts',
	],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	external: ['react', 'react-dom'],
});
