import { describe, expect, it } from 'vitest';
import { parseQueryParams } from './parseQueryParams';

describe('parseQueryParams', () => {
  it('should handle null input', () => {
    expect(parseQueryParams(null)).toEqual({});
  });

  it('should handle empty object', () => {
    expect(parseQueryParams({})).toEqual({});
  });

  it('should handle simple string values', () => {
    expect(parseQueryParams({ foo: 'bar', baz: 'qux' })).toEqual({
      foo: 'bar',
      baz: 'qux',
    });
  });

  it('should handle array values (multiple values with same key)', () => {
    expect(parseQueryParams({ tags: ['a', 'b', 'c'] })).toEqual({
      tags: ['a', 'b', 'c'],
    });
  });

  it('should handle dot notation for nested objects', () => {
    expect(
      parseQueryParams({
        'filter.name': 'john',
        'filter.age': '25',
        'filter.active': 'true',
      }),
    ).toEqual({
      filter: {
        name: 'john',
        age: '25',
        active: 'true',
      },
    });
  });

  it('should handle deeply nested objects', () => {
    expect(
      parseQueryParams({
        'user.profile.settings.theme': 'dark',
        'user.profile.settings.language': 'en',
        'user.profile.name': 'John',
      }),
    ).toEqual({
      user: {
        profile: {
          settings: {
            theme: 'dark',
            language: 'en',
          },
          name: 'John',
        },
      },
    });
  });

  it('should handle mixed simple and nested values', () => {
    expect(
      parseQueryParams({
        page: '1',
        'filter.status': 'active',
        tags: ['nodejs', 'typescript'],
        'filter.priority': 'high',
      }),
    ).toEqual({
      page: '1',
      filter: {
        status: 'active',
        priority: 'high',
      },
      tags: ['nodejs', 'typescript'],
    });
  });

  it('should skip undefined values', () => {
    expect(
      parseQueryParams({
        foo: 'bar',
        baz: undefined,
        qux: 'value',
      }),
    ).toEqual({
      foo: 'bar',
      qux: 'value',
    });
  });

  it('should handle empty string values', () => {
    expect(parseQueryParams({ foo: '', bar: 'value' })).toEqual({
      foo: '',
      bar: 'value',
    });
  });

  it('should overwrite non-object values when creating nested structure', () => {
    expect(
      parseQueryParams({
        filter: 'simple',
        'filter.name': 'john',
      }),
    ).toEqual({
      filter: {
        name: 'john',
      },
    });
  });

  it('should handle array values with dot notation', () => {
    expect(
      parseQueryParams({
        'filter.tags': ['a', 'b', 'c'],
      }),
    ).toEqual({
      filter: {
        tags: ['a', 'b', 'c'],
      },
    });
  });
});
