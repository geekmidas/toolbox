/**
 * The project's stage names, as types.
 *
 * `gkm.config.ts` declares the stages — `stages: { local: 'dev', deployed:
 * ['staging', 'prod'] }` — but constructs and application code cannot import
 * the config, so a stage name written anywhere else was a bare `string`: a
 * typo'd key in an `ExternalApi`'s `url` map was silently never read, and a
 * seed's `stage === 'prodution'` branch silently never ran.
 *
 * `gkm dev`, `gkm build` and `gkm test --prepare` write `.gkm/stages.d.ts`,
 * which fills this interface in from the loaded workspace:
 *
 * ```ts
 * declare module '@geekmidas/constructs' {
 *   interface Stages { local: 'dev'; deployed: 'staging' | 'prod' }
 * }
 * ```
 *
 * Until that file exists — a fresh clone, before the first run — the interface
 * is empty and every stage type below is `string`, so nothing fails to compile
 * for want of a generated file.
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled in by `.gkm/stages.d.ts`, which only an interface can be
export interface Stages {}

/** What `Stages` says under `key`, or `string` while it says nothing. */
type Declared<TKey extends string> = Stages extends {
	[K in TKey]: infer TStage extends string;
}
	? TStage
	: string;

/** The stage `gkm dev`, `exec`, `setup` and `test` run as: `stages.local`. */
export type LocalStage = Declared<'local'>;

/** A stage `gkm deploy --stage` accepts: one of `stages.deployed`. */
export type DeployedStage = Declared<'deployed'>;

/** What `gkm test` runs as. The CLI's own; no project stage may take it. */
export type TestStage = 'test';

/** Any stage the project's code can find itself running as. */
export type AnyStage = LocalStage | TestStage | DeployedStage;

/**
 * What a seed is handed beside its database.
 *
 * Seeds run on every stage, production included, so a seed that should write
 * something only somewhere — a demo tenant on the local stage, never on a
 * deployed one — decides by the stage it is given:
 *
 * ```ts
 * import type { SeedContext } from '@geekmidas/constructs';
 *
 * export async function seed(db: Kysely<Database>, { stage }: SeedContext) {
 *   if (stage === 'dev') await insertDemoTenant(db);
 * }
 * ```
 */
export interface SeedContext {
	/** The stage being seeded: the local one, `test`, or a deployed one. */
	stage: AnyStage;
}
