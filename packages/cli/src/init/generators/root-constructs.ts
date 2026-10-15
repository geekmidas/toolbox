import { migrationFolder, seedFolder } from '@geekmidas/manifest';
import { stamp } from '../../migrate/names.js';
import { databaseFor, emailFor } from '../constructs.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

// The fullstack workspace's root constructs, beyond the one-liners in
// `monorepo.ts`: the database and its access-control tables, the auth server
// signing in with magic links, the API, and the mailer with its template.

export function databaseConstruct(options: TemplateOptions): string {
	const db = databaseFor();
	const reviewerLinks = options.mobileApp
		? `
  /**
   * The latest sign-in link for each store reviewer's address
   * (\`@${options.name}/auth/reviewers\`), kept by the auth server instead of
   * mailed, and shown by the reviewer site.
   */
  reviewer_links: {
    email: string;
    url: string;
    expires_at: Date;
    created_at: Date;
  };`
		: '';

	return `import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { CamelCasePlugin, type Generated } from 'kysely';

/**
 * Your database schema. Add tables here.
 *
 * camelCase, because of the plugin below: the columns are snake_case in
 * Postgres (\`created_at\`), and Kysely maps between the two.
 */
export interface Database {
  users: {
    id: Generated<string>;
    /**
     * The Better Auth user this person signs in as. The auth schema is its
     * own, so this is a plain column, not a foreign key into it. Null for
     * someone the seeds named who has not signed in yet: their first sign-in
     * claims the row by email.
     */
    authUserId: string | null;
    name: string;
    email: string;
    createdAt: Generated<Date>;
  };
  /** Every permission there is: \`PERMISSIONS\` in \`@${options.name}/models/access\`. */
  permissions: {
    key: string;
    description: string;
  };
  /** A named set of permissions. Member and Super admin are the seeds'. */
  roles: {
    id: Generated<string>;
    name: string;
    description: string | null;
    isSystem: Generated<boolean>;
    createdAt: Generated<Date>;
  };
  rolePermissions: {
    roleId: string;
    permissionKey: string;
  };
  /** Who holds which role. A person holds every permission of every role. */
  userRoles: {
    userId: string;
    roleId: string;
    createdAt: Generated<Date>;
  };
}

/**
 * The database, declared once.
 *
 * The container, the database inside it, its roles and schema, and
 * \`${db.urlKey}\` all derive from this line — which is why nothing lists
 * \`postgres\` anywhere.
 */
export const database = new KyselyDatabase<Database, '${db.id}'>('${db.id}', {
  plugins: [new CamelCasePlugin()],
});

/**
 * The auth server's tables, as anything other than Better Auth reads them —
 * snake_case, because the tenant has no CamelCasePlugin: Better Auth names
 * its own columns.
 */
${
	reviewerLinks
		? `export interface AuthDatabase {${reviewerLinks}
}`
		: 'export type AuthDatabase = Record<string, never>;'
}

/**
 * The auth server's own schema in that same Postgres, with its own role.
 *
 * A schema tenant rather than a second database: one container, and a role
 * whose \`search_path\` is pinned, so Better Auth's tables cannot collide with
 * the application's. \`gkm migration auth\` writes its migrations from Better
 * Auth's schema and the plugins in \`constructs/auth.ts\`.
 */
export const authDatabase = database.schema<AuthDatabase, 'AuthDatabase'>(
  'AuthDatabase',
);
`;
}

export function authConstruct(options: TemplateOptions): string {
	const app = options.mobileApp === true;
	return `import { MAGIC_LINK_LIMITS, MAGIC_LINK_MINUTES } from '@${options.name}/auth/magic-link';
import {
  magicLinkEmailLimit,
  magicLinkSignIn,${app ? '\n  reviewerLinks,' : ''}
} from '@${options.name}/auth/server';${app ? "\nimport { expo } from '@better-auth/expo';" : ''}
import { BetterAuth } from '@geekmidas/constructs/auth';
import { authDatabase } from './database.ts';
import { email } from './email.ts';

/**
 * The auth server.
 *
 * There is no \`src/index.ts\` to go with this: the routes are a wildcard, so
 * no glob finds them and the build generates the entry from this declaration.
 * CORS, the trusted origins and the cookie domain come from whatever declared
 * an edge to it — nobody writes an origin down.
 *
 * Signing in and signing up are one flow: a magic link, and an account is
 * made the first time one is opened.
 */
export const auth = new BetterAuth('Auth', {
  path: 'apps/auth',
  database: authDatabase,
  basePath: '/api/auth',
  // An edge that arrives in \`services\` as a client: the mailer sends the
  // link — Mailpit locally, the stage's provider deployed.
  dependsOn: [email],
  options: async ({ services }) => ({
    // The same id is the \`users\` row's \`authUserId\`, so a uuid like every
    // other.
    advanced: { database: { generateId: 'uuid' } },

    // On in every stage, tests included — a limit only production has is one
    // no test has seen work. Counted in the tenant's \`rateLimit\` table, so
    // every instance shares the count.
    rateLimit: { enabled: true, storage: 'database' },

    plugins: [${
			app
				? `
      // The mobile app signs in through Better Auth's Expo plugin: it sends
      // its scheme as the origin, and this is what reads it.
      expo(),`
				: ''
		}
      magicLinkSignIn({
        sendMagicLink: async ({ email: to, url }) => {
          await services.${emailFor().service}.sendTemplate('magicLink', {
            to,
            subject: 'Sign in to ${options.name}',
            props: { url, minutes: MAGIC_LINK_MINUTES },
          });
        },
      }),
      magicLinkEmailLimit(MAGIC_LINK_LIMITS.perEmail),${
				app
					? `
      // Where a store reviewer's link is kept instead of mailed.
      reviewerLinks(),`
					: ''
			}
    ],
  }),
});
`;
}

export function apiConstruct(options: TemplateOptions): string {
	return `import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.ts';
import { logger } from './logger.ts';

/**
 * The application's HTTP surface — one RestApi, one container.
 *
 * \`path\` is where its app lives. Its handlers are found by the workspace's
 * \`constructs\` glob, and belong to it because they were built from it.
 */
export const api = new RestApi('Api', {
  path: '${options.apiPath}',

  // Typed out rather than omitted: an API that ships open because a field was
  // left off is the one default worth refusing to have.
  defaultAuthorizer: 'none',

  logger,
}).auth(auth);
`;
}

export function emailConstruct(): string {
	return `import { Email } from '@geekmidas/constructs/email';
import { MagicLink } from './templates/MagicLink.tsx';

/**
 * Outbound mail — Mailpit locally, the stage's provider deployed.
 *
 * Every email is one of these templates: what it says lives here, beside the
 * construct that sends it, not in the code that decides to send it.
 */
export const email = new Email('${emailFor().id}', {
  templates: { magicLink: MagicLink },
});
`;
}

export function magicLinkTemplate(name: string): string {
	return `import { Button, Link, Section, Text } from '@react-email/components';
import { Layout, styles } from './layout.tsx';

export interface MagicLinkProps {
  /** Where the link goes. Signed and single-use — it *is* the credential. */
  url: string;
  /** How long it works for. */
  minutes: number;
}

/**
 * The sign-in link: the whole of signing in. No password to choose, forget or
 * leak. The button is the email's first link, and the fallback prints the same
 * URL bare, so the plain-text part carries it too.
 */
export const MagicLink = ({ url, minutes }: MagicLinkProps) => (
  <Layout
    preview={\`Sign in to ${name}. The link expires in \${minutes} minutes.\`}
    reason="You're getting this because someone asked to sign in with this address. If it wasn't you, ignore it."
  >
    <Text style={styles.title}>Sign in to ${name}</Text>
    <Text style={styles.body}>
      {\`Use the button below to sign in. The link works once and expires in \${minutes} minutes.\`}
    </Text>
    <Section style={{ padding: '24px 0' }}>
      <Button href={url} style={styles.button}>
        Sign in
      </Button>
    </Section>
    <Text style={styles.small}>
      Button not working? Paste this link into your browser:
    </Text>
    <Link href={url} style={styles.link}>
      {url}
    </Link>
  </Layout>
);
`;
}

export function emailLayout(name: string): string {
	return `import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Every email's look, in one place. Inline styles: what every client draws. */
export const styles = {
  title: { fontFamily: font, fontSize: 22, fontWeight: 700, margin: 0 },
  body: { fontFamily: font, fontSize: 16, lineHeight: '24px', color: '#374151' },
  small: { fontFamily: font, fontSize: 13, color: '#6b7280' },
  button: {
    fontFamily: font,
    fontSize: 16,
    fontWeight: 600,
    backgroundColor: '#111827',
    color: '#ffffff',
    borderRadius: 8,
    padding: '14px 28px',
    textDecoration: 'none',
  },
  link: {
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: 13,
    color: '#2563eb',
    wordBreak: 'break-all',
  },
} as const satisfies Record<string, CSSProperties>;

export interface LayoutProps {
  /** The inbox's preview line, after the subject. */
  preview: string;
  /** Why this address got this email: the footer. */
  reason: string;
  children: ReactNode;
}

/**
 * Every email: a card with what it says, and a footer saying why it came.
 * Nothing in the layout is a link, so the first link in an email is always
 * its own call to action — and what a test's inbox reads as its link.
 */
export const Layout = ({ preview, reason, children }: LayoutProps) => (
  <Html lang="en">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={{ backgroundColor: '#f3f4f6', margin: 0, padding: '32px 16px' }}>
      <Container
        style={{
          maxWidth: 560,
          backgroundColor: '#ffffff',
          borderRadius: 12,
          padding: 32,
        }}
      >
        {children}
      </Container>
      <Section style={{ maxWidth: 560, textAlign: 'center', paddingTop: 16 }}>
        <Text style={styles.small}>{reason}</Text>
        <Text style={styles.small}>${name}</Text>
      </Section>
    </Body>
  </Html>
);
`;
}

/** \`users\` for a workspace: who signs in, linked to the auth server's user. */
export function workspaceUsersMigration(): GeneratedFile {
	return {
		path: `${migrationFolder(databaseFor().id)}/${stamp()}_create_users.ts`,
		content: `import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    // The Better Auth user this person signs in as. A plain column: the auth
    // schema is its own, and the id's format is Better Auth's to choose. Null
    // until someone the seeds named (an admin) first signs in.
    .addColumn('auth_user_id', 'text', (col) => col.unique())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute();
}
`,
	};
}

/**
 * Role-based access: a role is a set of permissions, and a person holds every
 * permission of every role they have. Only the tables — the catalogue and the
 * system roles are the seeds'.
 */
export function accessControlMigration(): GeneratedFile {
	// After the users table, which `user_roles` references.
	const later = new Date(Date.now() + 1000);
	return {
		path: `${migrationFolder(databaseFor().id)}/${stamp(later)}_create_access_control.ts`,
		content: `import type { Kysely } from 'kysely';

/**
 * Role-based access: a role is a set of permissions, and a person holds every
 * permission of every role they have.
 *
 * Only the tables. The permission catalogue and the system roles (Member,
 * Super admin) with their grants are reference data, written by the seeds
 * from \`PERMISSIONS\` and \`SYSTEM_ROLES\` in the models package.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('permissions')
    .addColumn('key', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('description', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('roles')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .execute();

  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'uuid', (col) =>
      col.notNull().references('roles.id').onDelete('cascade'),
    )
    // A permission dropped from the catalogue leaves every role with it.
    .addColumn('permission_key', 'varchar(64)', (col) =>
      col.notNull().references('permissions.key').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('role_permissions_pkey', [
      'role_id',
      'permission_key',
    ])
    .execute();

  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    // A role still held by someone cannot be deleted out from under them.
    .addColumn('role_id', 'uuid', (col) =>
      col.notNull().references('roles.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addPrimaryKeyConstraint('user_roles_pkey', ['user_id', 'role_id'])
    .execute();

  await db.schema
    .createIndex('user_roles_role_id_idx')
    .on('user_roles')
    .column('role_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_roles').execute();
  await db.schema.dropTable('role_permissions').execute();
  await db.schema.dropTable('roles').execute();
  await db.schema.dropTable('permissions').execute();
}
`,
	};
}

/**
 * The permission catalogue and the system roles, as the models package says:
 * upserts, run after every migration, so a changed list is applied by running
 * them again.
 */
export function accessControlSeeds(
	options: Pick<TemplateOptions, 'name' | 'adminEmail'>,
): GeneratedFile[] {
	const { name } = options;
	const folder = seedFolder(databaseFor().id);
	return [
		{
			path: `${folder}/01_permissions.ts`,
			content: `import { PERMISSION_KEYS, PERMISSIONS } from '@${name}/models/access';
import type { Kysely } from 'kysely';

type Tables = { permissions: { key: string; description: string } };

/**
 * The \`permissions\` table is \`PERMISSIONS\`, exactly: every key upserted with
 * its description, and any key no longer in code deleted — which takes it off
 * every role, since \`role_permissions\` cascades.
 */
export async function seed(db: Kysely<unknown>): Promise<void> {
  const tables = db.withTables<Tables>();

  await tables
    .insertInto('permissions')
    .values(
      PERMISSION_KEYS.map((key) => ({ key, description: PERMISSIONS[key] })),
    )
    .onConflict((oc) =>
      oc
        .column('key')
        .doUpdateSet((eb) => ({ description: eb.ref('excluded.description') })),
    )
    .execute();

  await tables
    .deleteFrom('permissions')
    .where('key', 'not in', PERMISSION_KEYS)
    .execute();
}
`,
		},
		{
			path: `${folder}/02_system_roles.ts`,
			content: `import { SYSTEM_ROLES } from '@${name}/models/access';
import type { Kysely } from 'kysely';

type Tables = {
  roles: { id?: string; name: string; description: string | null; is_system: boolean };
  role_permissions: { role_id: string; permission_key: string };
};

/**
 * Member and Super admin, as \`SYSTEM_ROLES\` says: upserted by name, and their
 * grants set to exactly their lists, so Super admin gets a new permission the
 * next time the seeds run. Runs after the permissions seed, so every key it
 * grants exists.
 */
export async function seed(db: Kysely<unknown>): Promise<void> {
  const tables = db.withTables<Tables>();
  const systemRoles = Object.values(SYSTEM_ROLES);

  const roles = await tables
    .insertInto('roles')
    .values(
      systemRoles.map((role) => ({
        name: role.name,
        description: role.description,
        is_system: true,
      })),
    )
    .onConflict((oc) =>
      oc.column('name').doUpdateSet((eb) => ({
        description: eb.ref('excluded.description'),
        is_system: true,
      })),
    )
    .returning(['id', 'name'])
    .execute();

  for (const role of systemRoles) {
    const { id } = roles.find((row) => row.name === role.name)!;
    await tables.deleteFrom('role_permissions').where('role_id', '=', id!).execute();
    if (role.permissions.length === 0) continue;
    await tables
      .insertInto('role_permissions')
      .values(role.permissions.map((key) => ({ role_id: id!, permission_key: key })))
      .execute();
  }
}
`,
		},
		adminsSeed(folder, options),
	];
}

/**
 * The Super admins, by email — the first one asked for by `gkm init`. Each
 * gets a `users` row before they have signed in, which their first sign-in
 * claims (`memberFor`), so the admin panel lets them in straight away.
 */
function adminsSeed(
	folder: string,
	options: Pick<TemplateOptions, 'name' | 'adminEmail'>,
): GeneratedFile {
	const admins = options.adminEmail
		? `[\n  '${options.adminEmail}',\n]`
		: "[\n  // 'you@example.com',\n]";
	return {
		path: `${folder}/03_admins.ts`,
		content: `import { SYSTEM_ROLES } from '@${options.name}/models/access';
import type { Kysely } from 'kysely';

/**
 * Who is a Super admin, by the address they sign in with. Add someone here and
 * run the seeds (\`gkm dev --seed\`, or the next deploy); taking them off the
 * list does not take the role away — the admin panel does that.
 */
const ADMINS: string[] = ${admins};

type Tables = {
  users: { id?: string; email: string; name: string };
  roles: { id: string; name: string; is_system: boolean };
  user_roles: { user_id: string; role_id: string };
};

/**
 * A \`users\` row for each admin who has none — their first sign-in claims it —
 * and the Member and Super admin roles. Runs after the system roles seed.
 */
export async function seed(db: Kysely<unknown>): Promise<void> {
  // Better Auth stores addresses lowercased; so does every \`users\` row.
  const emails = ADMINS.map((email) => email.trim().toLowerCase());
  if (emails.length === 0) return;

  const tables = db.withTables<Tables>();

  await tables
    .insertInto('users')
    .values(emails.map((email) => ({ email, name: email.split('@')[0]! })))
    .onConflict((oc) => oc.column('email').doNothing())
    .execute();

  const users = await tables
    .selectFrom('users')
    .select('id')
    .where('email', 'in', emails)
    .execute();
  const roles = await tables
    .selectFrom('roles')
    .select('id')
    .where('is_system', '=', true)
    .where('name', 'in', [SYSTEM_ROLES.Member.name, SYSTEM_ROLES.SuperAdmin.name])
    .execute();

  await tables
    .insertInto('user_roles')
    .values(
      users.flatMap((user) =>
        roles.map((role) => ({ user_id: user.id!, role_id: role.id })),
      ),
    )
    .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
    .execute();
}
`,
	};
}
