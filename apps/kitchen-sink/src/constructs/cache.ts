import { database } from './database.js';

/**
 * The app's cache — a table in the database this app already declared.
 *
 * `database.cache('Sessions')` rather than `new Cache('Sessions')` plus
 * `services.cache: 'db'`, and the difference is which artefact carries the
 * fact. The config form says *this deployment happens to cache in a database*,
 * which leaves every reader to work out which one: the URL composer, the table's
 * DDL, and the entry point that registers a driver all had to re-derive it, and
 * they did not agree.
 *
 * This form says *this app caches here*, once, in the graph. The URL is the
 * database's, the table lands in the database's schema owned by the database's
 * owner, and the generated entry registers the Postgres driver because the
 * declaration says so and not because a config file was consulted.
 *
 * It is also the only form that stays unambiguous when an app declares a second
 * database — which is why the backend config now refuses to guess rather than
 * picking the first one.
 *
 * `SESSIONS_URL` is unchanged either way: the id decides the key, and the id is
 * the same.
 */
export const sessions = database.cache('Sessions');
