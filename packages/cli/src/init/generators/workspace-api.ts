import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

/**
 * The fullstack API's sign-in half: who is calling, what they may do, and the
 * two endpoints every frontend reads — the caller's own profile, and the
 * admin panel's first page.
 *
 * `routePath` places an endpoint file by the routes structure the project
 * chose, as the rest of the API template does.
 */
export function workspaceApiFiles(
	options: TemplateOptions,
	routePath: (file: string) => string,
): GeneratedFile[] {
	const constructs = (file: string) => `@${options.name}/constructs/${file}.ts`;
	const models = `@${options.name}/models`;

	return [
		{
			path: 'src/router.ts',
			content: `import { HttpError, UnauthorizedError } from '@geekmidas/errors';
import { api } from '${constructs('api')}';
import { database } from '${constructs('database')}';
import { memberFor, permissionsOf } from '~/users/members.ts';

/**
 * The shared endpoint factory — no session required.
 *
 * Naming the database construct is what puts \`db\` in every handler built from
 * this router. Depend on other constructs per endpoint with \`.dependsOn([…])\`.
 */
export const router = api.database(database);

/** What a request built from a router is handed to find its session. */
type SessionContext = Parameters<Parameters<typeof router.session>[0]>[0];

/**
 * Requires someone signed in, as a member of this database.
 *
 * \`auth\` is the construct named in \`.auth()\` on the API, bound to this
 * request: it asks the auth server whose cookie this is. The first request
 * from a new account makes its \`users\` row, so a handler built from this
 * always has \`member\` — the row everything in this database refers to — and
 * every permission their roles grant, which \`can()\` checks.
 */
export const memberRouter = router.session(memberSession);

async function memberSession({ auth, db }: SessionContext) {
  const session = await auth.getSession();

  if (!session) {
    throw new UnauthorizedError('No active session');
  }

  const member = await memberFor(db, session.user);

  return {
    ...session,
    member,
    permissions: await permissionsOf(db, member.id),
  };
}

/**
 * For the admin panel: a member whose roles grant \`admin.access\`. Everyone
 * else is a 403 with the code \`staff_required\` — the same account still
 * signs in to the web site and the app, it just has no business here.
 *
 * Every staff endpoint is built from this, and names what else it needs with
 * \`.authorize(can(…))\`.
 */
export const staffRouter = router.session(async (context: SessionContext) => {
  const session = await memberSession(context);

  if (!session.permissions.includes('admin.access')) {
    throw new HttpError(403, 'This account has no access to the admin panel', {
      code: STAFF_REQUIRED,
    });
  }

  return session;
});

/** The code on a staff endpoint's 403 for someone who is only a member. */
export const STAFF_REQUIRED = 'staff_required';
`,
		},
		{
			path: 'src/access.ts',
			content: `import type { Permission } from '${models}/access';

/**
 * An endpoint's permission check: \`.authorize(can('users.view'))\`. Every
 * permission named is required; without them the request is answered 403.
 *
 * The keys are \`PERMISSIONS\` in \`${models}/access\`, typed, so an endpoint
 * cannot ask for one that does not exist; the seeds write the same list to the
 * database.
 */
export function can(...required: Permission[]) {
  return ({ session }: { session: { permissions: readonly Permission[] } }) =>
    required.every((permission) => session.permissions.includes(permission));
}
`,
		},
		{
			path: 'src/users/members.ts',
			content: `import type { Database } from '${constructs('database')}';
import { type Permission, SYSTEM_ROLES } from '${models}/access';
import type { Kysely } from 'kysely';

/** Who signed in, as the auth server's session says. */
interface SignedIn {
  id: string;
  email: string;
  name: string;
}

/**
 * The \`users\` row for whoever signed in, made the first time they call the
 * API and given the Member role. The auth server owns who someone is; this
 * row is what the application's own tables refer to.
 */
export async function memberFor(db: Kysely<Database>, user: SignedIn) {
  const found = await db
    .selectFrom('users')
    .selectAll()
    .where('authUserId', '=', user.id)
    .executeTakeFirst();
  if (found) return found;

  const member = await db
    .insertInto('users')
    .values({ authUserId: user.id, email: user.email, name: user.name })
    // Two first requests at once: the second finds the first's row.
    .onConflict((oc) => oc.column('authUserId').doUpdateSet({ email: user.email }))
    .returningAll()
    .executeTakeFirstOrThrow();

  const memberRole = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', SYSTEM_ROLES.Member.name)
    .where('isSystem', '=', true)
    .executeTakeFirst();
  if (memberRole) {
    await db
      .insertInto('userRoles')
      .values({ userId: member.id, roleId: memberRole.id })
      .onConflict((oc) => oc.columns(['userId', 'roleId']).doNothing())
      .execute();
  }

  return member;
}

/** Every permission \`userId\`'s roles grant, each once. */
export async function permissionsOf(
  db: Kysely<Database>,
  userId: string,
): Promise<Permission[]> {
  const rows = await db
    .selectFrom('userRoles')
    .innerJoin('rolePermissions', 'rolePermissions.roleId', 'userRoles.roleId')
    .select('rolePermissions.permissionKey')
    .distinct()
    .where('userRoles.userId', '=', userId)
    .execute();
  return rows.map((row) => row.permissionKey as Permission);
}
`,
		},
		{
			path: routePath('profiles/me.ts'),
			content: `import { ProfileSchema } from '${models}/profile';
import { memberRouter } from '~/router.ts';

/**
 * Who is signed in, and what they may do: what every frontend reads first.
 * The admin panel shows itself only to someone with \`admin.access\`.
 */
export const getMyProfileEndpoint = memberRouter
  .get('/profiles/me')
  .output(ProfileSchema)
  .handle(async ({ session }) => ({
    id: session.member.id,
    email: session.member.email,
    name: session.member.name,
    permissions: session.permissions,
  }));
`,
		},
		{
			path: 'src/__tests__/signing-in.spec.ts',
			content: signingInSpec(options.name),
		},
		{
			path: routePath('admin/users.ts'),
			content: `import { AdminUsersSchema } from '${models}/profile';
import { can } from '~/access.ts';
import { staffRouter } from '~/router.ts';

/** Everyone who has signed in, newest first: the admin panel's first page. */
export const listAdminUsersEndpoint = staffRouter
  .get('/admin/users')
  .authorize(can('users.view'))
  .output(AdminUsersSchema)
  .handle(async ({ db }) => ({
    users: await db
      .selectFrom('users')
      .select(['id', 'name', 'email'])
      .orderBy('createdAt', 'desc')
      .limit(100)
      .execute(),
  }));
`,
		},
	];
}

/** `packages/models/src/access.ts` and `profile.ts`: who may do what. */
export function accessModels(): GeneratedFile[] {
	return [
		{
			path: 'packages/models/src/access.ts',
			content: `import { z } from 'zod';

// ============================================
// Access control
// ============================================
//
// Roles are sets of permissions, and a person holds every permission of every
// role they have. This is the one list: the API's \`can()\` and the admin
// panel's gate name these keys, and the seeds write the \`permissions\` and
// \`roles\` tables from it — so nothing can ask for a permission that does not
// exist, and there is no second copy to drift.

/** Every permission, with what it lets someone do. */
export const PERMISSIONS = {
  'admin.access': 'Sign in to the admin panel',
  'users.view': 'View users',
  'system.staff': 'Manage staff and roles',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** A permission key, one of \`PERMISSIONS\`. */
export const PermissionSchema = z.enum(PERMISSION_KEYS);

/**
 * The roles every database has, kept by the seeds. Every other role is yours
 * to add.
 */
export const SYSTEM_ROLES = {
  /** Everyone has it: whoever signs in is given it. */
  Member: {
    name: 'Member',
    description: 'Everyone who has signed in.',
    permissions: [] as Permission[],
  },
  /** Every permission, including ones added later. */
  SuperAdmin: {
    name: 'Super admin',
    description: 'Every permission.',
    permissions: PERMISSION_KEYS,
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly Permission[] }
>;
`,
		},
		{
			path: 'packages/models/src/profile.ts',
			content: `import { z } from 'zod';
import { PermissionSchema } from './access.ts';

/** Who is signed in, and what they may do: \`GET /profiles/me\`. */
export const ProfileSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    permissions: z.array(PermissionSchema),
  })
  .meta({ id: 'Profile' });

export type Profile = z.infer<typeof ProfileSchema>;

/** The admin panel's list of people: \`GET /admin/users\`. */
export const AdminUsersSchema = z
  .object({
    users: z.array(
      z.object({ id: z.uuid(), name: z.string(), email: z.email() }),
    ),
  })
  .meta({ id: 'AdminUsers' });
`,
		},
	];
}

/**
 * `scripts/grant-admin.ts`: the first Super admin. Nobody can grant a role
 * before someone has one, so the first is granted from a terminal.
 */
export function grantAdminScript(options: TemplateOptions): GeneratedFile {
	return {
		path: 'scripts/grant-admin.ts',
		content: `/**
 * Make someone a Super admin — the first one, before the admin panel can.
 *
 *   gkm exec -- tsx scripts/grant-admin.ts you@example.com
 *
 * They need to have signed in once (the web site, the admin panel or the app),
 * which is what makes their \`users\` row.
 */
import { database } from '@${options.name}/constructs/database.ts';
import { SYSTEM_ROLES } from '@${options.name}/models/access';
import { EnvironmentParser } from '@geekmidas/envkit';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: gkm exec -- tsx scripts/grant-admin.ts <email>');
  process.exit(1);
}

const db = await database.service.register({
  envParser: new EnvironmentParser({ ...process.env }),
} as never);

try {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  if (!user) {
    console.error(\`No one has signed in as \${email} yet. Sign in once, then run this again.\`);
    process.exit(1);
  }

  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', SYSTEM_ROLES.SuperAdmin.name)
    .executeTakeFirstOrThrow();

  await db
    .insertInto('userRoles')
    .values({ userId: user.id, roleId: role.id })
    .onConflict((oc) => oc.columns(['userId', 'roleId']).doNothing())
    .execute();

  console.log(\`\${email} is a \${SYSTEM_ROLES.SuperAdmin.name}.\`);
} finally {
  await db.destroy();
}
`,
	};
}

/**
 * The API's feature tests: signing in by email end to end, and the admin
 * panel's gate. Each runs in a transaction, against the real auth server and
 * the real mail catcher.
 */
function signingInSpec(name: string): string {
	return `import { SYSTEM_ROLES } from '@${name}/models/access';
import { describe, expect } from 'vitest';
import { it } from '#test';

describe('signing in', () => {
  it('signs in with the emailed link, and is made a member', async ({
    browser,
    faker,
    mailbox,
  }) => {
    const email = faker.internet.email();

    await browser.auth.signIn.magicLink({ email });
    await browser.visit((await mailbox(email).last()).link!);

    expect(await browser.api.get('/profiles/me')).toMatchObject({
      email,
      permissions: [],
    });
  });

  it('refuses the profile to a browser that has not signed in', async ({
    browser,
  }) => {
    await expect(browser.api.get('/profiles/me')).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('the admin panel', () => {
  it('refuses someone who is only a member', async ({ browser }) => {
    await browser.signIn();

    await expect(browser.api.get('/admin/users')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets a Super admin in', async ({ browser, db }) => {
    await browser.signIn();
    const me = await browser.api.get('/profiles/me');
    const app = await db.get('database');
    const superAdmin = await app
      .selectFrom('roles')
      .select('id')
      .where('name', '=', SYSTEM_ROLES.SuperAdmin.name)
      .executeTakeFirstOrThrow();
    await app
      .insertInto('userRoles')
      .values({ userId: me.id, roleId: superAdmin.id })
      .execute();

    const { users } = await browser.api.get('/admin/users');

    expect(users).toContainEqual(expect.objectContaining({ id: me.id }));
  });
});
`;
}
