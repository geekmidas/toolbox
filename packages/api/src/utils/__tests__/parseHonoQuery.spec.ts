import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { parseHonoQuery } from '../parseHonoQuery';

describe('parseHonoQuery', () => {
  const createMockContext = (
    query: Record<string, string>,
    queries: Record<string, string[]> = {},
  ): Context => {
    return {
      req: {
        query: () => query,
        queries: (key: string) => queries[key] || [query[key]].filter(Boolean),
      },
    } as unknown as Context;
  };

  it('should handle single query parameters', () => {
    const c = createMockContext({ name: 'John', age: '30' });
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      name: 'John',
      age: '30',
    });
  });

  it('should handle array query parameters', () => {
    const c = createMockContext(
      { tags: 'typescript', colors: 'red' },
      {
        tags: ['typescript', 'javascript', 'node'],
        colors: ['red', 'blue'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      tags: ['typescript', 'javascript', 'node'],
      colors: ['red', 'blue'],
    });
  });

  it('should handle mixed single and array parameters', () => {
    const c = createMockContext(
      { name: 'Test', tags: 'first' },
      {
        tags: ['first', 'second'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      name: 'Test',
      tags: ['first', 'second'],
    });
  });

  it('should handle dot notation for nested objects', () => {
    const c = createMockContext({
      'user.name': 'John',
      'user.age': '30',
      'user.address.city': 'New York',
      'user.address.zip': '10001',
    });
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      user: {
        name: 'John',
        age: '30',
        address: {
          city: 'New York',
          zip: '10001',
        },
      },
    });
  });

  it('should handle both arrays and nested objects', () => {
    const c = createMockContext(
      {
        tags: 'tag1',
        'filter.status': 'active',
        'filter.type': 'user',
      },
      {
        tags: ['tag1', 'tag2', 'tag3'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      tags: ['tag1', 'tag2', 'tag3'],
      filter: {
        status: 'active',
        type: 'user',
      },
    });
  });

  it('should handle empty query parameters', () => {
    const c = createMockContext({});
    const result = parseHonoQuery(c);

    expect(result).toEqual({});
  });

  it('should handle single-value arrays as strings', () => {
    const c = createMockContext(
      { tag: 'solo' },
      {
        tag: ['solo'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      tag: 'solo',
    });
  });

  it('should overwrite existing values when dot notation conflicts', () => {
    const c = createMockContext({
      user: 'string-value',
      'user.name': 'John',
    });
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      user: {
        name: 'John',
      },
    });
  });

  it('should handle arrays in nested objects', () => {
    const c = createMockContext(
      {
        'user.roles': 'admin',
        'user.name': 'John',
        'settings.notifications.types': 'email',
      },
      {
        'user.roles': ['admin', 'moderator', 'user'],
        'settings.notifications.types': ['email', 'sms', 'push'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      user: {
        roles: ['admin', 'moderator', 'user'],
        name: 'John',
      },
      settings: {
        notifications: {
          types: ['email', 'sms', 'push'],
        },
      },
    });
  });

  it('should handle deeply nested arrays and mixed types', () => {
    const c = createMockContext(
      {
        'org.teams.frontend.members': 'alice',
        'org.teams.backend.members': 'bob',
        'org.teams.frontend.lead': 'charlie',
        'org.name': 'TechCorp',
        'org.config.features': 'auth',
        'org.config.enabled': 'true',
      },
      {
        'org.teams.frontend.members': ['alice', 'david', 'eve'],
        'org.teams.backend.members': ['bob', 'frank'],
        'org.config.features': ['auth', 'logging', 'analytics'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      org: {
        name: 'TechCorp',
        teams: {
          frontend: {
            members: ['alice', 'david', 'eve'],
            lead: 'charlie',
          },
          backend: {
            members: ['bob', 'frank'],
          },
        },
        config: {
          features: ['auth', 'logging', 'analytics'],
          enabled: 'true',
        },
      },
    });
  });

  it('should handle arrays at multiple nesting levels with empty values', () => {
    const c = createMockContext(
      {
        'data.items': 'item1',
        'data.nested.tags': 'tag1',
        'data.nested.deep.values': 'val1',
        'data.simple': 'test',
      },
      {
        'data.items': ['item1', 'item2', 'item3'],
        'data.nested.tags': ['tag1', 'tag2'],
        'data.nested.deep.values': ['val1', 'val2', 'val3', 'val4'],
      },
    );
    const result = parseHonoQuery(c);

    expect(result).toEqual({
      data: {
        items: ['item1', 'item2', 'item3'],
        simple: 'test',
        nested: {
          tags: ['tag1', 'tag2'],
          deep: {
            values: ['val1', 'val2', 'val3', 'val4'],
          },
        },
      },
    });
  });
});
