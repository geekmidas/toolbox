import { Topic } from '@geekmidas/constructs/topic';
import { Worker } from '@geekmidas/constructs/worker';
import { z } from 'zod';

export const notes = new Topic('Notes', {
	events: { 'note.created': z.object({ id: z.string() }) },
});

export const worker = new Worker('Jobs');
