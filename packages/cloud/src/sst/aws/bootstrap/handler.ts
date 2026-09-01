/**
 * The database bootstrap — role and schema DDL, run inside the VPC.
 *
 * SST provisions a cluster; nothing in Pulumi runs SQL. So the statements a
 * tenant needs — its owner, its runtime role, its schema, and the grants between
 * them — have to be applied by something that can reach the database, which on
 * AWS means a Lambda in the same VPC.
 *
 * It connects **as the cluster master**, because that is the only credential
 * that exists before any role does. That is also why this runs once per deploy
 * and nothing else holds those credentials: the master reaches this function
 * through its link and reaches nothing else.
 *
 * The statements come from `@geekmidas/db/pg/roles`, the same generator the
 * local target uses. One implementation is what stops "works locally, fails
 * deployed" — and it means the grants a developer tested against are the grants
 * production gets.
 */

import { roleStatements } from '@geekmidas/db/pg/roles';
import pg from 'pg';

/** One tenant to bootstrap. */
export interface BootstrapTenant {
	/** The construct id, so a failure can name it. */
	id: string;
	schema: string;
	runtime: string;
	owner: string;
	reader?: string;
	passwords: { runtime: string; owner: string; reader?: string };
}

export interface BootstrapEvent {
	/** The master credential, from the cluster's link. */
	master: {
		host: string;
		port: number;
		database: string;
		username: string;
		password: string;
	};
	tenants: BootstrapTenant[];
}

export interface BootstrapResult {
	applied: { tenant: string; describe: string; created: boolean }[];
}

/**
 * Apply every tenant's DDL, convergently.
 *
 * Each statement asks whether it is needed first, exactly as the local applier
 * does, so a re-deploy is free and a half-applied run recovers by running again.
 * That matters more here than locally: a Lambda can time out mid-way, and the
 * recovery has to be "invoke it again" rather than "work out what happened".
 */
export async function handler(event: BootstrapEvent): Promise<BootstrapResult> {
	const client = new pg.Client({
		host: event.master.host,
		port: event.master.port,
		database: event.master.database,
		user: event.master.username,
		password: event.master.password,
		// The cluster is inside the VPC and RDS presents a certificate this
		// runtime does not carry a root for. Encrypted, unverified — which is the
		// same posture the AWS SDK's own RDS helpers take, and worth naming rather
		// than leaving as an unexplained `false`.
		ssl: { rejectUnauthorized: false },
	});

	await client.connect();

	const applied: BootstrapResult['applied'] = [];

	try {
		for (const tenant of event.tenants) {
			for (const statement of roleStatements(tenant)) {
				if (statement.exists) {
					const { rows } = await client.query(
						statement.exists.sql,
						statement.exists.values,
					);

					if (rows.length > 0) {
						applied.push({
							tenant: tenant.id,
							describe: statement.describe,
							created: false,
						});
						continue;
					}
				}

				await client.query(statement.sql);
				applied.push({
					tenant: tenant.id,
					describe: statement.describe,
					// A grant has no existence check and re-granting is a no-op, so it
					// reports unchanged — a converged deploy still reads as converged.
					created: Boolean(statement.exists),
				});
			}
		}
	} finally {
		await client.end();
	}

	return { applied };
}
