/**
 * Dokploy as Pulumi resources — a prototype.
 *
 * The question it exists to answer: is wrapping Dokploy's REST API in a dynamic
 * provider worth doing for the rest of the resources? If it is, `deploy/state.ts`
 * and `SSMStateProvider` stop being necessary — remembering what you created is
 * the whole job of a state file — and `--target=server` becomes another
 * provisioner table rather than a deployment engine written by hand.
 *
 * One resource so far, and nothing has run against a real server.
 */

export {
	Application,
	type ApplicationArgs,
	appNameFor,
	diffApplication,
} from './Application';
