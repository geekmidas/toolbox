import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateReactQueryCommand } from '../openapi-react-query';
import { cleanupDir, createTempDir, createTestFile } from './test-helpers';

describe('React Query Generation', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir('react-query-test-');
	});

	afterEach(async () => {
		await cleanupDir(tempDir);
		vi.restoreAllMocks();
	});

	describe('generateReactQueryCommand', () => {
		it('should generate React Query hooks from OpenAPI spec', async () => {
			// Create mock OpenAPI spec
			const spec = {
				openapi: '3.0.0',
				info: {
					title: 'Test API',
					version: '1.0.0',
				},
				paths: {
					'/users': {
						get: {
							operationId: 'getUsers',
							responses: {
								'200': {
									description: 'Success',
									content: {
										'application/json': {
											schema: {
												type: 'array',
												items: {
													type: 'object',
													properties: {
														id: { type: 'string' },
														name: { type: 'string' },
													},
												},
											},
										},
									},
								},
							},
						},
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												name: { type: 'string' },
											},
										},
									},
								},
							},
							responses: {
								'201': {
									description: 'Created',
								},
							},
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');

			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
				name: 'TestAPI',
			});

			// Verify hooks file was created
			expect(existsSync(outputPath)).toBe(true);

			// Verify content
			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('createTypedQueryClient');
			expect(content).toContain('testapi');
			expect(content).toContain('useGetUsers');
			expect(content).toContain('useCreateUser');
			expect(content).toContain('export');
		});

		it('should throw error when OpenAPI spec not found', async () => {
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await expect(
				generateReactQueryCommand({
					input: join(tempDir, 'nonexistent.json'),
				}),
			).rejects.toThrow(/OpenAPI spec not found/);
		});

		it('should use default input and output paths', async () => {
			// Create spec in default location
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand();

			// Should create in default location
			const defaultPath = join(tempDir, 'src', 'api', 'hooks.ts');
			expect(existsSync(defaultPath)).toBe(true);
		});

		it('should generate query hooks for GET requests', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/users': {
						get: {
							operationId: 'listUsers',
							responses: { '200': { description: 'Success' } },
						},
					},
					'/users/{id}': {
						get: {
							operationId: 'getUser',
							parameters: [
								{
									name: 'id',
									in: 'path',
									required: true,
									schema: { type: 'string' },
								},
							],
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('useListUsers');
			expect(content).toContain('useGetUser');
			expect(content).toContain('Query Hooks');
		});

		it('should generate mutation hooks for non-GET requests', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							responses: { '201': { description: 'Created' } },
						},
					},
					'/users/{id}': {
						put: {
							operationId: 'updateUser',
							responses: { '200': { description: 'Updated' } },
						},
						delete: {
							operationId: 'deleteUser',
							responses: { '204': { description: 'Deleted' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('useCreateUser');
			expect(content).toContain('useUpdateUser');
			expect(content).toContain('useDeleteUser');
			expect(content).toContain('Mutation Hooks');
		});

		it('should create output directory if it does not exist', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'nested', 'dir', 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			expect(existsSync(outputPath)).toBe(true);
		});

		it('should generate TypeScript types file', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			// Should generate openapi-types.d.ts
			const typesPath = join(tempDir, 'openapi-types.d.ts');
			expect(existsSync(typesPath)).toBe(true);

			const typesContent = await readFile(typesPath, 'utf-8');
			expect(typesContent).toContain('export interface paths');
		});

		it('should handle operations without operationId', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/with-id': {
						get: {
							operationId: 'withId',
							responses: { '200': { description: 'OK' } },
						},
					},
					'/without-id': {
						get: {
							// No operationId
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			// Should only generate hook for operation with ID
			expect(content).toContain('useWithId');
			expect(content).not.toContain('useWithoutId');
		});

		it('should log generation progress', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
			const consoleSpy = vi.spyOn(console, 'log');

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Generating TypeScript types'),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('React Query hooks generated'),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Generated'),
			);
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('hooks'));
		});

		it('should handle invalid JSON in OpenAPI spec', async () => {
			const inputPath = join(tempDir, 'invalid.json');
			await createTestFile(tempDir, 'invalid.json', 'not valid json {[}]');

			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await expect(
				generateReactQueryCommand({ input: inputPath }),
			).rejects.toThrow(/React Query generation failed/);
		});

		it('should use custom API name', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
				name: 'MyCustomAPI',
			});

			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('mycustomapi');
		});

		it('should generate hooks with parameters', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/users/{userId}/posts/{postId}': {
						get: {
							operationId: 'getUserPost',
							parameters: [
								{ name: 'userId', in: 'path', required: true },
								{ name: 'postId', in: 'path', required: true },
								{ name: 'include', in: 'query' },
							],
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('useGetUserPost');
			// Should generate hook with params
			expect(content).toContain('config');
		});

		it('should generate type exports', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {
					'/users': {
						get: {
							operationId: 'getUsers',
							responses: { '200': { description: 'OK' } },
						},
						post: {
							operationId: 'createUser',
							responses: { '201': { description: 'Created' } },
						},
					},
				},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			expect(content).toContain('Type exports for convenience');
			expect(content).toContain('GetUsersResponse');
			expect(content).toContain('CreateUserResponse');
		});

		it('should handle spec with no paths', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'API', version: '1.0.0' },
				paths: {},
			};

			const inputPath = join(tempDir, 'openapi.json');
			await createTestFile(tempDir, 'openapi.json', JSON.stringify(spec));

			const outputPath = join(tempDir, 'hooks.ts');
			vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

			await generateReactQueryCommand({
				input: inputPath,
				output: outputPath,
			});

			const content = await readFile(outputPath, 'utf-8');

			// Should still generate base structure
			expect(content).toContain('createTypedQueryClient');
			expect(content).toContain('Query Hooks');
			expect(content).toContain('Mutation Hooks');
		});
	});
});
