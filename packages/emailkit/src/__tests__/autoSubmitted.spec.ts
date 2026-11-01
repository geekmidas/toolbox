import { describe, expect, it } from 'vitest';
import {
	autoReplying,
	currentAutoSubmitted,
	isAutoSubmitted,
} from '../autoSubmitted';
import { SMTPClient } from '../client';
import { parseEmail } from '../inbound';
import type { SMTPConfig } from '../types';

/**
 * A client whose transport hands the message back instead of sending it, so
 * the header is read from the real MIME nodemailer wrote.
 */
function capturing() {
	const sent: Uint8Array[] = [];
	const client = new SMTPClient({
		smtp: { streamTransport: true, buffer: true } as unknown as SMTPConfig,
		templates: {},
		defaults: { from: 'requests@acme.fixwell.example' },
	});
	const send = (to: string) => client.send({ to, subject: 'Hi', text: 'x' });
	// nodemailer's stream transport puts the raw message on `info.message`.
	const transporter = (client as unknown as { transporter: any }).transporter;
	const sendMail = transporter.sendMail.bind(transporter);
	transporter.sendMail = async (options: unknown) => {
		const info = await sendMail(options);
		sent.push(new Uint8Array(info.message));
		return info;
	};
	return { send, sent };
}

describe('Auto-Submitted', () => {
	it('marks mail sent inside autoReplying, however deep, and only that mail', async () => {
		const { send, sent } = capturing();

		await send('ada@resident.example');
		await autoReplying(async () => {
			await Promise.resolve();
			await send('ada@resident.example');
		});
		await send('ada@resident.example');

		const headers = await Promise.all(
			sent.map(async (raw) => (await parseEmail(raw)).headers),
		);
		expect(headers.map((h) => h['auto-submitted'])).toEqual([
			undefined,
			['auto-replied'],
			undefined,
		]);
		expect(currentAutoSubmitted()).toBeUndefined();
	});

	it('reads a header as automated unless it is absent or `no`', () => {
		expect(isAutoSubmitted({})).toBe(false);
		expect(isAutoSubmitted({ 'auto-submitted': ['no'] })).toBe(false);
		expect(isAutoSubmitted({ 'auto-submitted': [' No '] })).toBe(false);
		expect(isAutoSubmitted({ 'auto-submitted': ['auto-replied'] })).toBe(true);
		expect(
			isAutoSubmitted({ 'auto-submitted': ['Auto-Generated; owner=x'] }),
		).toBe(true);
	});
});
