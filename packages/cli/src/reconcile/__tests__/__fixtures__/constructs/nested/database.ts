/** A database and a tenant derived from it, found by the same single glob. */
export const orders = {
	id: 'Orders',
	declare: () => [{ kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] }],
};

export const auth = {
	id: 'Auth',
	declare: () => [
		{
			kind: 'database-schema',
			id: 'Auth',
			of: 'Orders',
			schema: 'auth',
			provides: ['AUTH_URL'],
		},
	],
};
