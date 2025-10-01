import { describe, expect, it, vi } from 'vitest';
import { parseHonoQuery } from '../parseHonoQuery';

// Mock Hono Context
function createMockContext(url: string) {
  const urlObj = new URL(url, 'http://localhost');
  const searchParams = urlObj.searchParams;

  // Create a map of all parameters
  const allParams: Record<string, string> = {};
  const queriesMap: Record<string, string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    allParams[key] = value;
    if (!queriesMap[key]) {
      queriesMap[key] = [];
    }
    queriesMap[key].push(value);
  }

  return {
    req: {
      query: vi.fn(() => allParams),
      queries: vi.fn((key?: string) => {
        if (key) {
          return queriesMap[key] || null;
        }
        return queriesMap;
      }),
    },
  } as any;
}

describe('parseHonoQuery', () => {
  it('should parse nested filter and pagination parameters correctly', () => {
    const url =
      '/explore/jobs?filter.box.topLeft.lat=40.77837308116122&filter.box.topLeft.lng=-73.88323603941639&filter.box.bottomRight.lat=40.626488942127196&filter.box.bottomRight.lng=-74.00399722759425&pagination.limit=100';

    const mockContext = createMockContext(url);
    const result = parseHonoQuery(mockContext);

    expect(result).toEqual({
      filter: {
        box: {
          topLeft: {
            lat: '40.77837308116122',
            lng: '-73.88323603941639',
          },
          bottomRight: {
            lat: '40.626488942127196',
            lng: '-74.00399722759425',
          },
        },
      },
      pagination: {
        limit: '100',
      },
    });
  });

  it('should handle simple query parameters', () => {
    const url = '/test?name=john&age=25';

    const mockContext = createMockContext(url);
    const result = parseHonoQuery(mockContext);

    expect(result).toEqual({
      name: 'john',
      age: '25',
    });
  });

  it('should handle array parameters', () => {
    const url = '/test?tags=red&tags=blue&tags=green';

    const mockContext = createMockContext(url);
    const result = parseHonoQuery(mockContext);

    expect(result).toEqual({
      tags: ['red', 'blue', 'green'],
    });
  });

  it('should handle mixed nested and array parameters', () => {
    const url =
      '/explore/jobs?filter.types=Server&filter.types=Waiter&filter.hourlyRate.min=15&filter.hourlyRate.max=25&pagination.limit=50';

    const mockContext = createMockContext(url);
    const result = parseHonoQuery(mockContext);

    expect(result).toEqual({
      filter: {
        types: ['Server', 'Waiter'],
        hourlyRate: {
          min: '15',
          max: '25',
        },
      },
      pagination: {
        limit: '50',
      },
    });
  });

  it('should handle deeply nested objects', () => {
    const url =
      '/test?user.profile.address.street=Main&user.profile.address.city=NYC&user.settings.theme=dark';

    const mockContext = createMockContext(url);
    const result = parseHonoQuery(mockContext);

    expect(result).toEqual({
      user: {
        profile: {
          address: {
            street: 'Main',
            city: 'NYC',
          },
        },
        settings: {
          theme: 'dark',
        },
      },
    });
  });

  it('should handle the specific explore/jobs test case', () => {
    // This is the exact URL you wanted to test
    const testUrl =
      '/explore/jobs?filter.box.topLeft.lat=40.77837308116122&filter.box.topLeft.lng=-73.88323603941639&filter.box.bottomRight.lat=40.626488942127196&filter.box.bottomRight.lng=-74.00399722759425&pagination.limit=100';

    const mockContext = createMockContext(testUrl);
    const result = parseHonoQuery(mockContext);

    // Verify the structure matches what the API expects
    expect(result).toHaveProperty('filter');
    expect(result).toHaveProperty('pagination');

    expect(result.filter).toHaveProperty('box');
    expect(result.filter.box).toHaveProperty('topLeft');
    expect(result.filter.box).toHaveProperty('bottomRight');

    expect(result.filter.box.topLeft).toEqual({
      lat: '40.77837308116122',
      lng: '-73.88323603941639',
    });

    expect(result.filter.box.bottomRight).toEqual({
      lat: '40.626488942127196',
      lng: '-74.00399722759425',
    });

    expect(result.pagination).toEqual({
      limit: '100',
    });

    // Test completed successfully
  });
});

// Helper function to test parseHonoQuery directly with a URL string
export function testParseHonoQuery(url: string) {
  const mockContext = createMockContext(url);
  return parseHonoQuery(mockContext);
}
