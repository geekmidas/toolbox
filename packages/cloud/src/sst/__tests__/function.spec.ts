import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { Cron } from '../aws/Cron';
import { Function } from '../aws/Function';
import { type GkmLinkable, ResourceType } from '../Linkable';

/**
 * A Lambda and a schedule as data: the args each hands SST (a recording stub
 * in `test/sst-globals.ts`), and the env validation that fails before deploy.
 */

const app = new App({
	name: 'shop',
	stage: 'prod',
	domain: 'shop.test',
	hostedZoneId: 'Z1',
	region: 'eu-west-1',
});
const stack = app.stack('jobs');
const db: GkmLinkable = { _id: 'db', _type: ResourceType.Postgres };

const argsOf = (component: unknown) =>
	(component as { args: Record<string, unknown> }).args;

describe('Function', () => {
	it('defaults the runtime and logging, and links only what its variables need', () => {
		const fn = new Function(stack, 'Reports', {
			handler: 'reports.handler',
			links: [db],
			envVars: ['DB_URL'],
			environment: { FEATURE: 'on' },
		});

		expect(fn._type).toBe(ResourceType.Function);
		expect(argsOf(fn)).toMatchObject({
			handler: 'reports.handler',
			runtime: 'nodejs24.x',
			logging: { format: 'json' },
			link: [db],
			environment: expect.objectContaining({
				SERVICE_NAME: 'Reports',
				STAGE: 'prod',
				FEATURE: 'on',
			}),
		});
		expect(fn.validate().valid).toBe(true);
	});

	it('keeps a runtime and logging it was given', () => {
		const fn = new Function(stack, 'Legacy', {
			handler: 'legacy.handler',
			runtime: 'nodejs20.x',
			logging: { format: 'text' },
		});

		expect(argsOf(fn)).toMatchObject({
			runtime: 'nodejs20.x',
			logging: { format: 'text' },
			link: [],
		});
	});

	it('fails the synth on a variable no link provides, unless told not to check', () => {
		expect(
			() =>
				new Function(stack, 'Mailer', {
					handler: 'mailer.handler',
					envVars: ['SMTP_URL'],
				}),
		).toThrow(/SMTP_URL/);

		const unchecked = new Function(stack, 'Mailer', {
			handler: 'mailer.handler',
			envVars: ['SMTP_URL'],
			autoValidate: false,
		});
		expect(unchecked.validate()).toMatchObject({
			valid: false,
			invalidVars: ['SMTP_URL'],
		});
	});
});

describe('Cron', () => {
	it('schedules the function it is given, by ARN', () => {
		const processor = { arn: 'arn:aws:lambda:eu-west-1:1:function:nightly' };
		const cron = new Cron(stack, 'Nightly', {
			processor: processor as never,
			schedule: 'rate(1 day)',
			enabled: false,
		});

		expect(argsOf(cron)).toEqual({
			enabled: false,
			schedule: 'rate(1 day)',
			function: processor.arn,
		});
	});
});

describe('App and Stack', () => {
	it('pick a value for the stage, falling back to the default', () => {
		expect(app.select({ prod: 'live', default: 'test' })).toBe('live');
		expect(stack.select({ staging: 'test', default: 'dev' } as never)).toBe(
			'dev',
		);
	});

	it('name subdomains and URLs under the root domain', () => {
		expect(stack.domain).toBe('shop.test');
		expect(stack.getSubdomain('api')).toBe('api.shop.test');
		expect(stack.getURL('api')).toBe('https://api.shop.test');
		expect(stack.getURL()).toBe('https://shop.test');
		expect(app.getURL()).toBe('https://shop.test');
	});

	it('prefix physical names with the stage, app and stack', () => {
		expect(app.logicalPrefixedName('Uploads')).toBe('prod-shop-uploads');
		expect(stack.logicalPrefixedName('Uploads')).toBe('prod-shop-jobs-uploads');
	});
});
