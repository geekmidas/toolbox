/** Two constructs in one file, and a non-construct export beside them. */
export const uploads = {
	id: 'Uploads',
	declare: () => [
		{ kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	],
};

export const mail = {
	id: 'Mail',
	declare: () => [
		{ kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
	],
};

export const NOT_A_CONSTRUCT = { id: 'Nope' };
export function alsoNot() {}
