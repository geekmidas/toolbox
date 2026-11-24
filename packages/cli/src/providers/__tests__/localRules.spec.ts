/**
 * What a provider kind is on the local stage — `LOCAL_PROVIDER_RULES`, one
 * place — and what the config check and the stage's choice make of it.
 */

import { describe, expect, it } from 'vitest';
import { UnknownStageKey } from '../../workspace/stages';
import {
	assertProviderStageKeys,
	ProviderNotForLocalStage,
	stageProvider,
} from '../config';
import { LOCAL_PROVIDER_RULES, type ProviderKind } from '../types';

const stages = { local: 'dev', deployed: ['staging', 'prod'] };

/** One entry a kind's provider check accepts, by kind. */
const ENTRY: Record<ProviderKind, object> = {
	objects: { provider: 's3', region: 'eu-west-1' },
	inbox: { provider: 'ses', region: 'eu-west-1' },
	email: { provider: 'ses', region: 'eu-west-1' },
	mobile: { provider: 'google-play', developer: '1234567890' },
	maps: { provider: 'google' },
};

describe('a provider named for the local stage', () => {
	it.for([
		['objects', 'MinIO serves objects'],
		['inbox', 'Mailpit serves inbox'],
		['email', 'Mailpit serves email'],
		['mobile', 'a store listing belongs to a deployed stage'],
	] as const)('is refused for %s, naming why', ([kind, why]) => {
		const check = () =>
			assertProviderStageKeys(kind, { dev: ENTRY[kind] }, stages);

		expect(check).toThrow(ProviderNotForLocalStage);
		expect(check).toThrow(why);
	});

	it('is allowed for maps, which has no local stand-in', () => {
		expect(() =>
			assertProviderStageKeys('maps', { dev: ENTRY.maps }, stages),
		).not.toThrow();
	});

	it.for([
		'objects',
		'maps',
	] as const)('is still a deployed stage or nothing for %s', (kind) => {
		expect(() =>
			assertProviderStageKeys(kind, { stagin: ENTRY[kind] }, stages),
		).toThrow(UnknownStageKey);
	});

	it('says the rule of every kind in one place', () => {
		expect(
			Object.fromEntries(
				Object.entries(LOCAL_PROVIDER_RULES).map(([kind, rule]) => [
					kind,
					rule.mode,
				]),
			),
		).toEqual({
			objects: 'stand-in',
			inbox: 'stand-in',
			email: 'stand-in',
			mobile: 'none',
			maps: 'provisioned',
		});
	});
});

describe("the local stage's choice", () => {
	const workspace = (kind: ProviderKind) => ({
		stages,
		deploy: { [kind]: { dev: ENTRY[kind], prod: ENTRY[kind] } },
	});

	it.for([
		'objects',
		'inbox',
		'email',
		'mobile',
	] as const)('is external for %s, whatever the config says', (kind) => {
		expect(stageProvider(workspace(kind), kind, 'dev')).toEqual({
			mode: 'external',
		});
	});

	it('is the named provider for maps', () => {
		expect(stageProvider(workspace('maps'), 'maps', 'dev')).toMatchObject({
			mode: 'provider',
			name: 'google',
		});
	});

	it('is external for maps when the local stage names none', () => {
		expect(
			stageProvider({ stages, deploy: { maps: {} } }, 'maps', 'dev'),
		).toEqual({ mode: 'external' });
	});
});
