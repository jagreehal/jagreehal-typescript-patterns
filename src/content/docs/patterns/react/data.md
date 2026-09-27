---
title: "Data Fetching with React Query"
description: "React Query as the baseline for server state, with waterfalls eliminated and loading states handled through Suspense."
sidebar:
  order: 3
---

*Use this page when you are fetching, caching, or invalidating server data in a component.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Data Fetching: React Query as Baseline

React Query is required to standardize:

- caching and dedupe
- retries/backoff
- stale-while-revalidate
- query invalidation
- optimistic updates (when appropriate)
- pagination + infinite scrolling

### Query Key Factories

```ts
// queries/userKeys.ts -stable, composable key factory
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  profile: (id: string) => [...userKeys.detail(id), 'profile'] as const,
};

// Usage
queryClient.invalidateQueries({ queryKey: userKeys.lists() });  // Invalidate all lists
queryClient.invalidateQueries({ queryKey: userKeys.detail('123') });  // Invalidate one user
```

> **Key stability:** Query keys must be JSON-serializable (strings, numbers, booleans, null, plain objects/arrays). Don't include Dates, functions, or class instances. Since `filters` comes from Zod URL parsing, it's already safe.

### Query Hooks

```ts
// queries/useUserQuery.ts
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { type ApiError } from '@/lib/api-error';
import { userKeys } from './userKeys';
import type { User } from '@/types';

type UseUserQueryOptions = Omit<
  UseQueryOptions<User, ApiError, User, ReturnType<typeof userKeys.detail>>,
  'queryKey' | 'queryFn'
>;

export function useUserQuery(userId: string, options?: UseUserQueryOptions) {
  return useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetchJson<User>(`/api/users/${userId}`),
    staleTime: 5 * 60 * 1000,  // 5 minutes
    ...options,
  });
}
```

### Mutation with Invalidation

```ts
// queries/useUpdateUserMutation.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { userKeys } from './userKeys';

export function useUpdateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      fetchJson<User>(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (updatedUser) => {
      // Update the cache directly
      queryClient.setQueryData(userKeys.detail(updatedUser.id), updatedUser);
      // Invalidate lists (they may have changed order/filtering)
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
```

### Optimistic Updates

```ts
// queries/useToggleFavoriteMutation.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { productKeys, type Product } from './useProductsQuery';

export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: string) =>
      fetchJson<{ success: boolean }>(`/api/favorites/${productId}`, { method: 'POST' }),
    onMutate: async (productId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: productKeys.detail(productId) });

      // Snapshot previous value
      const previous = queryClient.getQueryData<Product>(productKeys.detail(productId));

      // Optimistically update
      if (previous) {
        queryClient.setQueryData(productKeys.detail(productId), {
          ...previous,
          isFavorite: !previous.isFavorite,
        });
      }

      return { previous };
    },
    onError: (_err, productId, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(productKeys.detail(productId), context.previous);
      }
    },
    onSettled: (_data, _err, productId) => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) });
    },
  });
}
```

### React Query Policy

House rules for React Query:

| Policy | Default |
| ------ | ------- |
| `staleTime` | 5 minutes for most queries; 0 for frequently-changing data |
| Retries | Up to 3 retries for transient failures (5xx, network errors, 408 timeout, 429 rate limit); **no retry on other 4xx** (client errors won't succeed on retry) |
| Cache updates | Prefer `setQueryData` for optimistic UI; use `invalidateQueries` when server state may have diverged |
| Mutation errors | Show user-facing error; log unexpected errors (5xx, network); don't retry automatically (user should confirm action) |
| Background refetch | Enable `refetchOnWindowFocus` for fresh data; disable for expensive queries |

**Prerequisite:** For retry logic to detect HTTP status codes, all query functions must throw a typed error. Define a shared `ApiError` and use it consistently:

```ts
// lib/api-error.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// lib/fetch-json.ts -all queries use this
import { ApiError } from './api-error';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await response.json().catch(() => ({}));
      message = body.message ?? message;
      code = body.code;
    }

    throw new ApiError(message, response.status, code);
  }

  // ✅ handle empty responses
  if (response.status === 204) {
    return undefined as T;
  }

  // Some endpoints return 200 + empty body
  const text = await response.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}
```

### Canonical QueryProvider

Production teams need a single place for QueryClient, error logging, and devtools. Don't scatter defaults across files.

```tsx
// providers/QueryProvider.tsx
'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ApiError } from '@/lib/api-error';

function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Global error logging (Sentry, etc.)
        // Skip expected 4xx client errors (validation, not found, etc.)
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return;
        console.error('Query error:', { queryKey: query.queryKey, error });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        // Skip expected 4xx client errors (validation, not found, etc.)
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return;
        const key = mutation.options.mutationKey ?? ['unknown-mutation'];
        console.error('Mutation error:', { mutationKey: key, error });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,  // 5 minutes
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            // 429 (rate limit) and 408 (timeout) are transient -retry them
            if (error.status === 429 || error.status === 408) {
              return failureCount < 3;
            }
            // Other 4xx are client errors -won't succeed on retry
            if (error.status >= 400 && error.status < 500) {
              return false;
            }
          }
          // 5xx, network errors, timeouts -retry up to 3 times
          return failureCount < 3;
        },
      },
      mutations: {
        retry: false,  // User should explicitly retry mutations
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Prevent QueryClient recreation on re-renders
  const [client] = React.useState(createQueryClient);

  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

Wire it once in your root layout:

```tsx
// app/layout.tsx
import { QueryProvider } from '@/providers/QueryProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

### SSR / prefetch (framework-specific, architecture-stable)

- If your framework supports SSR/RSC/prefetch, do it at the boundary.
- The reusable code still uses the same React Query key conventions and hooks.
- Hydration is wiring.

```tsx
// Next.js App Router example: prefetch at the route boundary
// app/users/[id]/page.tsx (this IS the container, lives in app/, not components/)
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { userKeys } from '@/queries/userKeys';
import { fetchUser } from '@/queries/fetchUser';
import { UserProfileView } from '@/components/UserProfileView';  // View from components/

export default async function UserPage({ params }: { params: { id: string } }) {
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: userKeys.detail(params.id),
    queryFn: () => fetchUser(params.id),
  });

  // Pass userId to a client wrapper that uses the prefetched data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UserProfileClient userId={params.id} />
    </HydrationBoundary>
  );
}

// Client component in same file or app/users/[id]/UserProfileClient.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useUserQuery } from '@/queries/useUserQuery';
import { UserProfileView } from '@/components/UserProfileView';

function UserProfileClient({ userId }: { userId: string }) {
  const { data: user } = useUserQuery(userId);  // Uses prefetched data
  const router = useRouter();

  const handlers = {
    onEdit: () => router.push(`/users/${userId}/edit`),
  };

  if (!user) return null;  // Suspense handles loading

  return <UserProfileView user={user} handlers={handlers} />;
}
```

---

## Eliminating Waterfalls

Sequential `await` is the most common performance bug. When two operations don't depend on each other, run them together for a 2x to 10x speedup.

```ts
// ❌ BAD: three sequential round trips
const user = await fetchUser(id);
const posts = await fetchPosts(id);
const prefs = await fetchPrefs(id);

// ✅ GOOD: one round trip
const [user, posts, prefs] = await Promise.all([
  fetchUser(id),
  fetchPosts(id),
  fetchPrefs(id),
]);
```

For partial dependencies, start each promise as early as possible and await at the end. You don't need an extra library.

```ts
// ✅ profile depends on user; config is independent
const userPromise = fetchUser(id);
const profilePromise = userPromise.then((u) => fetchProfile(u.id));

const [user, config, profile] = await Promise.all([
  userPromise,
  fetchConfig(),
  profilePromise,
]);
```

The same rule holds anywhere you await: route handlers, server actions, loaders, and query functions. Start work immediately, await late.

```ts
// ❌ config waits for auth; data waits for both
const session = await auth();
const config = await fetchConfig();
const data = await fetchData(session.userId);

// ✅ auth and config fly in parallel
const sessionPromise = auth();
const configPromise = fetchConfig();
const session = await sessionPromise;
const [config, data] = await Promise.all([configPromise, fetchData(session.userId)]);
```

### Defer await until the branch needs it

Don't await data that a branch may never use. Check cheap synchronous conditions first.

```ts
// ❌ BAD: fetches permissions even when the resource is missing
async function updateResource(resourceId: string, userId: string) {
  const permissions = await fetchPermissions(userId);
  const resource = await getResource(resourceId);
  if (!resource) return { error: 'Not found' };
  if (!permissions.canEdit) return { error: 'Forbidden' };
  return updateResourceData(resource, permissions);
}

// ✅ GOOD: cheap check first, fetch only when the path needs it
async function updateResource(resourceId: string, userId: string) {
  const resource = await getResource(resourceId);
  if (!resource) return { error: 'Not found' };
  const permissions = await fetchPermissions(userId);
  if (!permissions.canEdit) return { error: 'Forbidden' };
  return updateResourceData(resource, permissions);
}
```

The same rule applies to feature flags. Guard the async call with the cheap condition.

```ts
// ❌ pays for the flag lookup every time
const flag = await getFlag();
if (flag && isWeekend) { /* ... */ }

// ✅ skips the network call when isWeekend is false
if (isWeekend) {
  const flag = await getFlag();
  if (flag) { /* ... */ }
}
```

## Loading States + Suspense

### Loading UX rules

- Distinguish:
  - **initial load** (page skeleton)
  - **subsequent updates** (inline spinner, subtle "refreshing", optimistic state)
- Prefer skeletons for layout stability.
- Keep loading UI close to the component boundary it affects.

### Example: Loading States

```tsx
// Skeleton component for layout stability
function UserCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border p-4">
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

// Container with proper loading states
function UserListContainer() {
  const { data, isLoading, isFetching, isError, refetch } = useUsersQuery();

  if (isLoading) {
    // Initial load -show skeletons
    return (
      <div className="grid gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <UserCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="relative">
      {/* Subtle indicator for background refetch */}
      {isFetching && (
        <div className="absolute right-0 top-0">
          <Spinner size="sm" />
        </div>
      )}
      <UserListView users={data ?? []} />
    </div>
  );
}
```

### Respect reduced motion

Users who set `prefers-reduced-motion` get vestibular relief. Animate `transform` and `opacity` only, and gate non-essential motion.

- Set the Tailwind `motion-safe:` variant on decorative animation (`animate-pulse`, spinners, transitions).
- Never use `transition: all`. List the properties (`transition-colors`, `transition-transform`).
- For JS-driven motion, read the query and branch.

```tsx
// Skeleton stays visible but stops pulsing for reduced-motion users
function UserCardSkeleton() {
  return (
    <div className="motion-safe:animate-pulse rounded-lg border p-4">
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

// hooks/useReducedMotion.ts reuses the useMediaQuery primitive
export function useReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
```

Global fallback for third-party animation you don't control:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Suspense rules

- Use Suspense boundaries around data-driven subtrees or code-split chunks.
- Choose fallbacks intentionally (skeletons, placeholders).
- Never let one Suspense boundary block unrelated UI.

```tsx
// ❌ BAD: One Suspense boundary blocks everything
function Dashboard() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Header />        {/* Blocked by slow UserStats */}
      <UserStats />     {/* This is slow */}
      <RecentActivity /> {/* Blocked by slow UserStats */}
      <QuickActions />  {/* Blocked by slow UserStats */}
    </Suspense>
  );
}
```

```tsx
// ✅ GOOD: Isolated Suspense boundaries
function Dashboard() {
  return (
    <>
      <Header />

      <div className="grid grid-cols-3 gap-4">
        <Suspense fallback={<StatsSkeleton />}>
          <UserStats />  {/* Slow component isolated */}
        </Suspense>

        <Suspense fallback={<ActivitySkeleton />}>
          <RecentActivity />
        </Suspense>

        <QuickActions />  {/* No data fetching, renders immediately */}
      </div>
    </>
  );
}
```

---

## Related Pages

- [Error Boundaries](../errors) for what happens when a query fails.
- [Server Components](../server-components) for data that never needs to reach the client.
- [MSW and Testing](../testing) for deterministic responses in tests and stories.
