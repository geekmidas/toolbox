# 6. Secrets

## 6.1 Encrypted Secrets

```typescript
// packages/cli/src/secrets/encryption.ts

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

export interface EncryptedSecrets {
  version: 1;
  algorithm: typeof ALGORITHM;
  salt: string;      // hex
  iv: string;        // hex
  authTag: string;   // hex
  data: string;      // hex (encrypted JSON)
}

/**
 * Encrypt secrets using AES-256-GCM with scrypt key derivation.
 * The encryption key is derived from a passphrase using scrypt.
 */
export async function encryptSecrets(
  secrets: Record<string, unknown>,
  passphrase: string,
): Promise<EncryptedSecrets> {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive key using scrypt
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH) as Buffer;

  // Encrypt
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(secrets);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ALGORITHM,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

/**
 * Decrypt secrets using AES-256-GCM.
 */
export async function decryptSecrets(
  encrypted: EncryptedSecrets,
  passphrase: string,
): Promise<Record<string, unknown>> {
  const salt = Buffer.from(encrypted.salt, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');
  const data = Buffer.from(encrypted.data, 'hex');

  // Derive key using scrypt
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH) as Buffer;

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}
```

## 6.2 Secrets Storage

```typescript
// packages/cli/src/secrets/storage.ts - EXTEND

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { encryptSecrets, decryptSecrets, type EncryptedSecrets } from './encryption';

const SECRETS_DIR = '.gkm/secrets';

/**
 * Write encrypted secrets that can be committed to git.
 * Only the passphrase needs to be shared separately.
 */
export async function writeEncryptedSecrets(
  stage: string,
  secrets: Record<string, unknown>,
  passphrase: string,
): Promise<void> {
  const encrypted = await encryptSecrets(secrets, passphrase);

  await mkdir(SECRETS_DIR, { recursive: true });
  const filePath = join(SECRETS_DIR, `${stage}.enc.json`);

  await writeFile(filePath, JSON.stringify(encrypted, null, 2));
}

/**
 * Read and decrypt secrets from committed file.
 */
export async function readEncryptedSecrets(
  stage: string,
  passphrase: string,
): Promise<Record<string, unknown> | null> {
  const filePath = join(SECRETS_DIR, `${stage}.enc.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  const encrypted = JSON.parse(content) as EncryptedSecrets;

  return decryptSecrets(encrypted, passphrase);
}

/**
 * Check if encrypted secrets exist for a stage.
 */
export function encryptedSecretsExist(stage: string): boolean {
  return existsSync(join(SECRETS_DIR, `${stage}.enc.json`));
}
```

---

[← Previous: Docker](./5-docker.md) | [Next: Client Generation →](./7-client-generation.md)
