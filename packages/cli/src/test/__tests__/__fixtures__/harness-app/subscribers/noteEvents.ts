import { notes, worker } from '../constructs/topics.js';

// A subscriber, which delivery loads: the harness must import it itself.
export const onNoteCreated = worker
	.topic(notes)
	.subscribe(['note.created'])
	.handle(async () => {});

// What `worker.webhooks(hooks)` returns — a subscriber and a cron — exported
// destructured, as an app exports it: found by the name it is exported as.
const webhooksOf = () => ({
	deliver: worker
		.topic(notes)
		.subscribe(['note.created'])
		.handle(async () => {}),
	sweep: worker.cron('rate(1 minute)').handle(async () => {}),
});
export const { deliver: deliverNotes, sweep: retryNotes } = webhooksOf();
