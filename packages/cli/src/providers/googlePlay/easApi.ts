/**
 * EAS, as the `google-play` provider reaches it: the GraphQL API eas-cli
 * itself calls, with an `EXPO_TOKEN` — to upload a Google service account
 * key and assign it to the app's Android credentials for EAS Submit, which
 * is what `eas credentials` does interactively, and to find the store build
 * a new app's first upload is.
 *
 * The documents are eas-cli's own (24.x), each selecting only what gkm reads:
 * eas-cli's credentials fragment also brings back the app's keystore and its
 * passwords, which gkm has no reason to hold.
 */

import { GkmError } from '../../errors';

export const EAS_GRAPHQL = 'https://api.expo.dev/graphql';

/** No `EXPO_TOKEN` to call EAS with. */
export class ExpoTokenMissing extends GkmError {
	constructor() {
		super(
			'gkm keeps the key EAS Submit uses with an access token, and EXPO_TOKEN is not ' +
				'set. Create one at https://expo.dev/settings/access-tokens and export ' +
				'it as EXPO_TOKEN.',
		);
		this.name = 'ExpoTokenMissing';
	}
}

/** EAS refused a call. */
export class EasApiError extends GkmError {
	constructor(
		readonly operation: string,
		readonly detail: string,
	) {
		super(`EAS refused ${operation}: ${detail}`);
		this.name = 'EasApiError';
	}
}

/** A Google service account key, as EAS holds it. */
export interface EasGoogleKey {
	id: string;
	clientEmail: string;
	privateKeyIdentifier: string;
}

const KEY_FIELDS = 'id clientEmail privateKeyIdentifier';

export interface EasApi {
	/** The project's owner account. */
	project(projectId: string): Promise<{
		accountId: string;
		accountName: string;
		fullName: string;
	}>;
	/** The app's Android credentials for a package, created when absent. */
	androidCredentials(
		project: { projectId: string; fullName: string },
		packageName: string,
	): Promise<{ id: string; submissionsKey?: EasGoogleKey }>;
	/** Upload a key file's JSON to the account. */
	createKey(
		accountId: string,
		json: Record<string, unknown>,
	): Promise<EasGoogleKey>;
	/** Make a key the one EAS Submit uses for the credentials. */
	assignForSubmissions(credentialsId: string, keyId: string): Promise<void>;
	/** Every key on the account. */
	keys(accountName: string): Promise<EasGoogleKey[]>;
	deleteKey(id: string): Promise<void>;
	/**
	 * The SHA-1 of each keystore EAS signs the package's builds with — what an
	 * Android Maps key is restricted to beside Play's signing certificate.
	 * Only the fingerprints: never the keystore or its passwords.
	 */
	keystoreSha1s(projectId: string, packageName: string): Promise<string[]>;
	/**
	 * The newest finished Android store build of the project, and where its
	 * `.aab` is downloaded from — what a new app's first upload is.
	 */
	latestStoreBuild(
		projectId: string,
	): Promise<{ id: string; url: string } | undefined>;
}

export function easApi(
	token: string | undefined = process.env.EXPO_TOKEN,
	endpoint: string = EAS_GRAPHQL,
): EasApi {
	const call = async <T>(
		operation: string,
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> => {
		if (!token) throw new ExpoTokenMissing();
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ query, variables, operationName: operation }),
		});
		const body = (await response.json().catch(() => ({}))) as {
			data?: T;
			errors?: { message: string }[];
		};
		if (!response.ok || body.errors?.length || !body.data) {
			throw new EasApiError(
				operation,
				body.errors?.map((error) => error.message).join('; ') ||
					`HTTP ${response.status}`,
			);
		}
		return body.data;
	};

	const credentialsFields = `id googleServiceAccountKeyForSubmissions { ${KEY_FIELDS} }`;
	type Credentials = {
		id: string;
		googleServiceAccountKeyForSubmissions: EasGoogleKey | null;
	};
	const asCredentials = (credentials: Credentials) => ({
		id: credentials.id,
		...(credentials.googleServiceAccountKeyForSubmissions
			? { submissionsKey: credentials.googleServiceAccountKeyForSubmissions }
			: {}),
	});

	return {
		async project(projectId) {
			const data = await call<{
				app: {
					byId: {
						fullName: string;
						ownerAccount: { id: string; name: string };
					};
				};
			}>(
				'AppByIdQuery',
				`query AppByIdQuery($appId: String!) {
  app { byId(appId: $appId) { id fullName ownerAccount { id name } } }
}`,
				{ appId: projectId },
			);
			const app = data.app.byId;
			return {
				accountId: app.ownerAccount.id,
				accountName: app.ownerAccount.name,
				fullName: app.fullName,
			};
		},

		async androidCredentials(project, packageName) {
			const found = await call<{
				app: { byFullName: { androidAppCredentials: Credentials[] } };
			}>(
				'AndroidAppCredentialsByApplicationIdentifierQuery',
				`query AndroidAppCredentialsByApplicationIdentifierQuery(
  $projectFullName: String!
  $applicationIdentifier: String
  $legacyOnly: Boolean
) {
  app {
    byFullName(fullName: $projectFullName) {
      id
      androidAppCredentials(
        filter: { applicationIdentifier: $applicationIdentifier, legacyOnly: $legacyOnly }
      ) { ${credentialsFields} }
    }
  }
}`,
				{
					projectFullName: project.fullName,
					applicationIdentifier: packageName,
					legacyOnly: false,
				},
			);
			const existing = found.app.byFullName.androidAppCredentials[0];
			if (existing) return asCredentials(existing);

			const created = await call<{
				androidAppCredentials: { createAndroidAppCredentials: Credentials };
			}>(
				'CreateAndroidAppCredentialsMutation',
				`mutation CreateAndroidAppCredentialsMutation(
  $androidAppCredentialsInput: AndroidAppCredentialsInput!
  $appId: ID!
  $applicationIdentifier: String!
) {
  androidAppCredentials {
    createAndroidAppCredentials(
      androidAppCredentialsInput: $androidAppCredentialsInput
      appId: $appId
      applicationIdentifier: $applicationIdentifier
    ) { ${credentialsFields} }
  }
}`,
				{
					androidAppCredentialsInput: {},
					appId: project.projectId,
					applicationIdentifier: packageName,
				},
			);
			return asCredentials(
				created.androidAppCredentials.createAndroidAppCredentials,
			);
		},

		async createKey(accountId, json) {
			const data = await call<{
				googleServiceAccountKey: {
					createGoogleServiceAccountKey: EasGoogleKey;
				};
			}>(
				'CreateGoogleServiceAccountKeyMutation',
				`mutation CreateGoogleServiceAccountKeyMutation(
  $googleServiceAccountKeyInput: GoogleServiceAccountKeyInput!
  $accountId: ID!
) {
  googleServiceAccountKey {
    createGoogleServiceAccountKey(
      googleServiceAccountKeyInput: $googleServiceAccountKeyInput
      accountId: $accountId
    ) { ${KEY_FIELDS} }
  }
}`,
				{ googleServiceAccountKeyInput: { jsonKey: json }, accountId },
			);
			return data.googleServiceAccountKey.createGoogleServiceAccountKey;
		},

		async assignForSubmissions(credentialsId, keyId) {
			await call(
				'SetGoogleServiceAccountKeyForSubmissionsMutation',
				`mutation SetGoogleServiceAccountKeyForSubmissionsMutation(
  $androidAppCredentialsId: ID!
  $googleServiceAccountKeyId: ID!
) {
  androidAppCredentials {
    setGoogleServiceAccountKeyForSubmissions(
      id: $androidAppCredentialsId
      googleServiceAccountKeyId: $googleServiceAccountKeyId
    ) { id }
  }
}`,
				{
					androidAppCredentialsId: credentialsId,
					googleServiceAccountKeyId: keyId,
				},
			);
		},

		async keys(accountName) {
			const keys: EasGoogleKey[] = [];
			let after: string | null = null;
			do {
				const data: {
					account: {
						byName: {
							googleServiceAccountKeysPaginated: {
								edges: { node: EasGoogleKey }[];
								pageInfo: { hasNextPage: boolean; endCursor: string | null };
							};
						};
					};
				} = await call(
					'GoogleServiceAccountKeysPaginatedByAccountQuery',
					`query GoogleServiceAccountKeysPaginatedByAccountQuery(
  $accountName: String!
  $after: String
  $first: Int
) {
  account {
    byName(accountName: $accountName) {
      id
      googleServiceAccountKeysPaginated(after: $after, first: $first) {
        edges { node { ${KEY_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`,
					{ accountName, after, first: 50 },
				);
				const page = data.account.byName.googleServiceAccountKeysPaginated;
				keys.push(...page.edges.map((edge) => edge.node));
				after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
			} while (after);
			return keys;
		},

		async keystoreSha1s(projectId, packageName) {
			const data = await call<{
				app: {
					byId: {
						androidAppCredentials: {
							androidAppBuildCredentialsList: {
								androidKeystore: {
									sha1CertificateFingerprint: string | null;
								} | null;
							}[];
						}[];
					};
				};
			}>(
				'AndroidKeystoreFingerprintsQuery',
				`query AndroidKeystoreFingerprintsQuery(
  $appId: String!
  $applicationIdentifier: String
) {
  app {
    byId(appId: $appId) {
      id
      androidAppCredentials(
        filter: { applicationIdentifier: $applicationIdentifier, legacyOnly: false }
      ) {
        id
        androidAppBuildCredentialsList {
          id
          androidKeystore { id sha1CertificateFingerprint }
        }
      }
    }
  }
}`,
				{ appId: projectId, applicationIdentifier: packageName },
			);
			const fingerprints = data.app.byId.androidAppCredentials.flatMap(
				(credentials) =>
					credentials.androidAppBuildCredentialsList.flatMap((build) =>
						build.androidKeystore?.sha1CertificateFingerprint
							? [build.androidKeystore.sha1CertificateFingerprint]
							: [],
					),
			);
			return [...new Set(fingerprints.map(sha1Fingerprint))].sort();
		},

		async latestStoreBuild(projectId) {
			const data = await call<{
				app: {
					byId: {
						builds: {
							id: string;
							artifacts: { buildUrl: string | null } | null;
						}[];
					};
				};
			}>(
				'ViewBuildsOnAppQuery',
				`query ViewBuildsOnAppQuery(
  $appId: String!
  $offset: Int!
  $limit: Int!
  $filter: BuildFilter
) {
  app {
    byId(appId: $appId) {
      id
      builds(offset: $offset, limit: $limit, filter: $filter) {
        id
        artifacts { buildUrl }
      }
    }
  }
}`,
				{
					appId: projectId,
					offset: 0,
					limit: 1,
					filter: {
						platform: 'ANDROID',
						status: 'FINISHED',
						distribution: 'STORE',
					},
				},
			);
			const build = data.app.byId.builds[0];
			const url = build?.artifacts?.buildUrl;
			return build && url ? { id: build.id, url } : undefined;
		},

		async deleteKey(id) {
			await call(
				'DeleteGoogleServiceAccountKeyMutation',
				`mutation DeleteGoogleServiceAccountKeyMutation($googleServiceAccountKeyId: ID!) {
  googleServiceAccountKey { deleteGoogleServiceAccountKey(id: $googleServiceAccountKeyId) { id } }
}`,
				{ googleServiceAccountKeyId: id },
			);
		},
	};
}

/**
 * A certificate's SHA-1 the way Google takes it: uppercase hex, a colon
 * between each byte — whether EAS wrote the colons or not.
 */
export function sha1Fingerprint(value: string): string {
	const hex = value.replace(/:/g, '').toUpperCase();
	return hex.match(/.{2}/g)?.join(':') ?? hex;
}
