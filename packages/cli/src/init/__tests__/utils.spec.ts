import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkDirectoryExists,
  detectPackageManager,
  validateProjectName,
} from '../utils.js';

describe('validateProjectName', () => {
  it('should accept valid project names', () => {
    expect(validateProjectName('my-project')).toBe(true);
    expect(validateProjectName('my_project')).toBe(true);
    expect(validateProjectName('myProject')).toBe(true);
    expect(validateProjectName('my-project-123')).toBe(true);
    expect(validateProjectName('project')).toBe(true);
  });

  it('should reject empty names', () => {
    expect(validateProjectName('')).toBe('Project name is required');
  });

  it('should reject names with invalid characters', () => {
    const result = validateProjectName('my project');
    expect(result).toContain('can only contain');
  });

  it('should accept scoped package names', () => {
    // @ / . are valid for scoped npm packages
    expect(validateProjectName('@my/project')).toBe(true);
    expect(validateProjectName('my.project')).toBe(true);
  });

  it('should reject names with other special characters', () => {
    expect(validateProjectName('my$project')).toContain('can only contain');
    expect(validateProjectName('my#project')).toContain('can only contain');
    expect(validateProjectName('my!project')).toContain('can only contain');
  });
});

describe('checkDirectoryExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cli-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return true for non-existent directory', () => {
    expect(checkDirectoryExists('non-existent-dir', tempDir)).toBe(true);
  });

  it('should return error for existing directory', async () => {
    const existingDir = 'existing-dir';
    await mkdir(join(tempDir, existingDir));
    const result = checkDirectoryExists(existingDir, tempDir);
    expect(result).toContain('already exists');
  });
});

describe('detectPackageManager', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cli-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    originalEnv = process.env.npm_config_user_agent;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.npm_config_user_agent = originalEnv;
    } else {
      delete process.env.npm_config_user_agent;
    }
  });

  it('should detect pnpm from user agent', () => {
    process.env.npm_config_user_agent = 'pnpm/8.0.0';
    expect(detectPackageManager(tempDir)).toBe('pnpm');
  });

  it('should detect yarn from user agent', () => {
    process.env.npm_config_user_agent = 'yarn/4.0.0';
    expect(detectPackageManager(tempDir)).toBe('yarn');
  });

  it('should detect bun from user agent', () => {
    process.env.npm_config_user_agent = 'bun/1.0.0';
    expect(detectPackageManager(tempDir)).toBe('bun');
  });

  it('should default to npm when no lockfile or user agent', () => {
    delete process.env.npm_config_user_agent;
    expect(detectPackageManager(tempDir)).toBe('npm');
  });
});
