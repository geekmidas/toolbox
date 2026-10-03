import { notes, worker } from '../constructs/topics.js';

// A subscriber, which delivery loads: the harness must import it itself.
export const onNoteCreated = worker
	.topic(notes)
	.subscribe(['note.created'])
	.handle(async () => {});
