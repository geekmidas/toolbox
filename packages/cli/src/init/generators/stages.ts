import type { StagesConfig } from '../../workspace/types.js';

/** The `stages` block a generated gkm.config.ts declares, indented two spaces. */
export function stagesBlock(stages: StagesConfig): string {
	const list = (names: readonly string[]) =>
		`[${names.map((name) => `'${name}'`).join(', ')}]`;

	return `
  // Named by this project and read by every command: \`gkm dev\`, \`exec\` and
  // \`test\` run as \`local\`, and \`gkm deploy --stage\` accepts only \`deployed\`.
  stages: {
    local: '${stages.local}',
    deployed: ${list(stages.deployed)},${
			stages.protected?.length
				? `
    // Retained and protected on removal.
    protected: ${list(stages.protected)},`
				: ''
		}
  },`;
}

/**
 * The `STAGE` the scaffolded env config parses: one of the declared stages,
 * defaulting to the local one.
 */
export function stageEnv(stages: StagesConfig): string {
	const names = [stages.local, ...stages.deployed]
		.map((name) => `'${name}'`)
		.join(', ');

	return `get('STAGE').enum([${names}]).default('${stages.local}')`;
}
