import {
  createTypedQueryClient,
  useTypedInfiniteQuery,
} from '@geekmidas/api/client';

// Example API types
interface Paths {
  '/api/posts': {
    get: {
      parameters: {
        query: {
          page?: number;
          limit?: number;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              pages: Array<{ id: string; title: string }>;
              nextPage: number | null;
              totalPages: number;
            };
          };
        };
      };
    };
  };
}

// Create typed client
const client = createTypedQueryClient<Paths>();

// Example component using infinite query
export function PostList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useTypedInfiniteQuery(
    client,
    'GET /api/posts',
    {
      getNextPageParam: (lastPage) => {
        // Return the next page number or undefined if no more pages
        return lastPage.nextPage ?? undefined;
      },
      initialPageParam: 1,
    },
    {
      query: {
        limit: 10,
      },
    },
  );

  if (isLoading) return <div>Loading...</div>;
  if (isError) return <div>Error loading posts</div>;

  return (
    <div>
      {data?.pages.map((post) => (
        <div key={post.id}>
          <div key={post.id}>
            <h3>{post.title}</h3>
          </div>
        </div>
      ))}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading more...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
