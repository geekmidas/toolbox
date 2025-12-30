import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFiles } from '../dev';

describe('loadEnvFiles', () => {
  let testDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `gkm-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Reset process.env to original state
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Reset process.env
    process.env = originalEnv;
  });

  it('should load a single .env file', () => {
    writeFileSync(join(testDir, '.env'), 'TEST_VAR=hello\nANOTHER_VAR=world');

    const { loaded, missing } = loadEnvFiles('.env', testDir);

    expect(loaded).toEqual(['.env']);
    expect(missing).toEqual([]);
    expect(process.env.TEST_VAR).toBe('hello');
    expect(process.env.ANOTHER_VAR).toBe('world');
  });

  it('should load multiple env files in order', () => {
    writeFileSync(join(testDir, '.env'), 'VAR1=base\nVAR2=base');
    writeFileSync(join(testDir, '.env.local'), 'VAR2=local\nVAR3=local');

    const { loaded, missing } = loadEnvFiles(['.env', '.env.local'], testDir);

    expect(loaded).toEqual(['.env', '.env.local']);
    expect(missing).toEqual([]);
    expect(process.env.VAR1).toBe('base');
    expect(process.env.VAR2).toBe('local'); // Overridden by .env.local
    expect(process.env.VAR3).toBe('local');
  });

  it('should report missing files when explicitly configured', () => {
    writeFileSync(join(testDir, '.env'), 'VAR=value');

    const { loaded, missing } = loadEnvFiles(
      ['.env', '.env.local', '.env.missing'],
      testDir,
    );

    expect(loaded).toEqual(['.env']);
    expect(missing).toEqual(['.env.local', '.env.missing']);
    expect(process.env.VAR).toBe('value');
  });

  it('should not report missing .env when using default', () => {
    // No .env file exists
    const { loaded, missing } = loadEnvFiles(undefined, testDir);

    expect(loaded).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('should handle undefined config with default .env', () => {
    writeFileSync(join(testDir, '.env'), 'DEFAULT_VAR=default');

    const { loaded, missing } = loadEnvFiles(undefined, testDir);

    expect(loaded).toEqual(['.env']);
    expect(missing).toEqual([]);
    expect(process.env.DEFAULT_VAR).toBe('default');
  });

  it('should handle string config as single file', () => {
    writeFileSync(join(testDir, '.env.production'), 'PROD_VAR=production');

    const { loaded, missing } = loadEnvFiles('.env.production', testDir);

    expect(loaded).toEqual(['.env.production']);
    expect(missing).toEqual([]);
    expect(process.env.PROD_VAR).toBe('production');
  });

  it('should override earlier files with later files', () => {
    writeFileSync(join(testDir, '.env'), 'SHARED=first\nONLY_FIRST=yes');
    writeFileSync(join(testDir, '.env.local'), 'SHARED=second');
    writeFileSync(join(testDir, '.env.dev'), 'SHARED=third\nONLY_DEV=yes');

    const { loaded } = loadEnvFiles(
      ['.env', '.env.local', '.env.dev'],
      testDir,
    );

    expect(loaded).toEqual(['.env', '.env.local', '.env.dev']);
    expect(process.env.SHARED).toBe('third');
    expect(process.env.ONLY_FIRST).toBe('yes');
    expect(process.env.ONLY_DEV).toBe('yes');
  });

  it('should handle empty env files', () => {
    writeFileSync(join(testDir, '.env'), '');

    const { loaded, missing } = loadEnvFiles('.env', testDir);

    expect(loaded).toEqual(['.env']);
    expect(missing).toEqual([]);
  });

  it('should handle env files with comments', () => {
    writeFileSync(
      join(testDir, '.env'),
      '# This is a comment\nVAR=value\n# Another comment',
    );

    const { loaded } = loadEnvFiles('.env', testDir);

    expect(loaded).toEqual(['.env']);
    expect(process.env.VAR).toBe('value');
  });
});
