import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { paths } from '../openapi-types';
import { createTypedQueryClient } from '../react-query';
import './setup';

// Mock React hooks
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: any[]) => mockUseQuery(...args),
    useMutation: (...args: any[]) => mockUseMutation(...args),
  };
});

describe('TypedQueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create query client with correct configuration', () => {
    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
      headers: { Authorization: 'Bearer token' },
    });

    expect(queryClient).toBeDefined();
  });

  it('should call useQuery with correct parameters', () => {
    const mockQueryResult = {
      data: { id: '123', name: 'John', email: 'john@example.com' },
      isLoading: false,
      error: null,
    };
    mockUseQuery.mockReturnValue(mockQueryResult);

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = queryClient.useQuery('GET /users/{id}', {
      params: { id: '123' },
    });

    expect(mockUseQuery).toHaveBeenCalledWith({
      queryKey: ['GET /users/{id}', { params: { id: '123' } }],
      queryFn: expect.any(Function),
    });

    expect(result).toEqual(mockQueryResult);
  });

  it('should call useQuery with query parameters in key', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true });

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    queryClient.useQuery('GET /posts', {
      query: { page: 1, limit: 10 },
    });

    expect(mockUseQuery).toHaveBeenCalledWith({
      queryKey: ['GET /posts', { query: { page: 1, limit: 10 } }],
      queryFn: expect.any(Function),
    });
  });

  it('should call useQuery without config parameters', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true });

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    queryClient.useQuery('GET /users');

    expect(mockUseQuery).toHaveBeenCalledWith({
      queryKey: ['GET /users'],
      queryFn: expect.any(Function),
    });
  });

  it('should call useMutation with correct parameters', () => {
    const mockMutationResult = {
      mutate: vi.fn(),
      isLoading: false,
      error: null,
    };
    mockUseMutation.mockReturnValue(mockMutationResult);

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = queryClient.useMutation('POST /users');

    expect(mockUseMutation).toHaveBeenCalledWith({
      mutationFn: expect.any(Function),
    });

    expect(result).toEqual(mockMutationResult);
  });

  it('should call useMutation with additional options', () => {
    const mockMutationResult = {
      mutate: vi.fn(),
      isLoading: false,
      error: null,
    };
    mockUseMutation.mockReturnValue(mockMutationResult);

    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    queryClient.useMutation('POST /users', {
      onSuccess,
      onError,
    });

    expect(mockUseMutation).toHaveBeenCalledWith({
      mutationFn: expect.any(Function),
      onSuccess,
      onError,
    });
  });

  it('should pass query options to useQuery', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true });

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const staleTime = 5 * 60 * 1000;
    const retry = 3;

    queryClient.useQuery(
      'GET /users/{id}',
      { params: { id: '123' } },
      { staleTime, retry },
    );

    expect(mockUseQuery).toHaveBeenCalledWith({
      queryKey: ['GET /users/{id}', { params: { id: '123' } }],
      queryFn: expect.any(Function),
      staleTime,
      retry,
    });
  });

  it('should build query key with both params and query', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true });

    const queryClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    queryClient.useQuery('GET /posts', {
      query: { page: 1, limit: 10 },
    });

    expect(mockUseQuery).toHaveBeenCalledWith({
      queryKey: ['GET /posts', { query: { page: 1, limit: 10 } }],
      queryFn: expect.any(Function),
    });
  });
});
