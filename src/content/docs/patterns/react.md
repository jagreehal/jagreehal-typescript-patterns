---
title: React Architecture Guide
description: A definitive, framework-agnostic React guide with concrete examples for responsibilities, state, data, DI, Storybook, testing, MSW, React Query, error boundaries, and essential ESLint rules.
---

This guide is **framework-agnostic**. It applies to **Next.js**, **TanStack Start**, **Astro (SSR)**, **Remix**, **Vite SPA**, etc.

The goal: **keep reusable React code independent of routing/rendering frameworks**, with clear responsibilities, explicit dependencies, predictable state, and great testing/Storybook ergonomics.

---

## Core Principles

- **Frameworks are adapters.** Routing and rendering are boundary concerns. Your reusable UI and domain logic should not import framework APIs.
- **Parent components own integration.** Parents orchestrate state + data + effects; children render.
- **Prefer URL state.** If the state is shareable, bookmarkable, or navigation-relevant, it belongs in the query string.
- **React Query is required.** Standardize server-state caching, dedupe, retries, and mutations.
- **DI for handlers.** Pass typed handlers/deps into components to make testing and Storybook trivial. **Rule:** Inject anything that causes side effects (network, navigation, analytics, toasts). Import pure utilities freely.
- **Split containers from views.** Components that read URL / fetch / subscribe are separated from presentational components. **Rule:** Reusable folders (`components/`, `hooks/`, `queries/`, `lib/`) are framework-import-forbidden. Containers live only at the framework boundary (`app/`, `pages/`, `routes/`).
- **Error boundaries + Suspense are not optional.**
- **Every component has a paired Storybook story.**
- **Testing is value-driven.** Don't test for the sake of it -test where it reduces real risk.
- **Tailwind default.** Favor composability and consistent UI patterns.

---

## Responsibilities: The Parent Component Rule

### Parent components (containers) are responsible for

- Reading route params + query string (from whatever framework)
- Parsing/validating inputs (typed model)
- Initiating data fetching (React Query hooks) or receiving prefetched data
- Choosing loading/error/empty UI states
- Wiring typed handlers (DI)
- Orchestrating state combinations (what can happen together)
- Managing transitions and side effects (where needed)

### Child components (views) are responsible for

- Rendering based on props
- Being easy to reuse, test, and story
- Avoiding framework coupling and side effects

### Client islands are responsible for

- Browser-only APIs (`window`, `localStorage`, websockets, `useEffect`)
- Subscriptions / realtime updates
- Animations tied to the DOM
- Anything that requires client execution

**Default split:**

- `XContainer` → reads + fetches + wires
- `XView` → renders
- `XClient` → subscriptions/effects (only if needed)

> **Naming convention:** Use `ThingContainer`, `ThingView`, `ThingClient` when separation is needed. Default to `ThingView` alone if no integration logic exists.

### The Adapter Layer: Portable Framework APIs

Teams still accidentally couple to `useRouter`, `navigate`, `notFound`, etc. because there's no explicit adapter surface. Define framework-agnostic interfaces and implement them at the boundary:

```ts
// lib/platform/ports.ts -framework-agnostic ports
export type NavigationApi = {
  push: (href: string) => void;
  replace?: (href: string) => void;
  back?: () => void;
};

export type ToastService = {
  success: (message: string) => void;
  error: (message: string) => void;
};

export type Analytics = {
  track: (event: string, data?: Record<string, unknown>) => void;
};
```

```ts
// adapters/navigation.ts -wrap whatever router your framework gives you
type RouterLike = {
  push: (href: string) => void;
  replace?: (href: string) => void;
  back?: () => void;
};

export function createNavigationAdapter(router: RouterLike): NavigationApi {
  return {
    push: (href) => router.push(href),
    replace: router.replace ? (href) => router.replace!(href) : undefined,
    back: router.back ? () => router.back!() : undefined,
  };
}
```

Now containers depend on `NavigationApi`, not on framework-specific hooks. Storybook provides a stub, tests provide a mock, and migrating frameworks means swapping a single adapter file.

### Example: User Profile Feature

```tsx
// ❌ BAD: View component with framework coupling and data fetching
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

export function UserProfile() {
  const { id } = useParams();  // Framework coupling
  const { data, isLoading } = useQuery({  // Data fetching in view
    queryKey: ['user', id],
    queryFn: () => fetchUser(id),
  });

  if (isLoading) return <Spinner />;
  return <div>{data?.name}</div>;
}
```

```tsx
// ✅ GOOD: Container handles framework + data, View is pure

// UserProfileView.tsx -pure, framework-agnostic, easy to test/story
type UserProfileViewProps = {
  user: User;
  handlers: {
    onEdit: () => void;
    onDelete: () => void;
  };
};

export function UserProfileView({ user, handlers }: UserProfileViewProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{user.name}</h1>
      <p className="text-gray-600">{user.email}</p>
      <div className="mt-4 space-x-2">
        <button onClick={handlers.onEdit}>Edit</button>
        <button onClick={handlers.onDelete}>Delete</button>
      </div>
    </div>
  );
}

// UserProfileContainer.tsx -framework boundary, wires everything
'use client';

import { useParams, useRouter } from 'next/navigation';

import { createNavigationAdapter } from '@/adapters/navigation';
import { useUserQuery } from '@/queries/useUserQuery';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserProfileView } from './UserProfileView';

export function UserProfileContainer() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const nav = createNavigationAdapter(router);

  const deleteUserMutation = useDeleteUserMutation();
  const { data: user, isLoading, error } = useUserQuery(id);

  const handlers = {
    onEdit: () => nav.push(`/users/${id}/edit`),
    onDelete: () => deleteUserMutation.mutate(id),
  };

  if (isLoading) return <UserProfileSkeleton />;
  if (error) return <ErrorState error={error} />;
  if (!user) return <EmptyState title="User not found" />;

  return <UserProfileView user={user} handlers={handlers} />;
}
```

### Example: Client Island for Realtime

```tsx
// UserPresenceClient.tsx -client island for websocket subscription
'use client';

import { useEffect, useState } from 'react';

type UserPresenceClientProps = {
  userId: string;
  deps: {
    subscribe: (userId: string, onStatus: (status: Status) => void) => () => void;
  };
};

export function UserPresenceClient({ userId, deps }: UserPresenceClientProps) {
  const [status, setStatus] = useState<Status>('unknown');

  useEffect(() => {
    const unsubscribe = deps.subscribe(userId, setStatus);
    return unsubscribe;
  }, [userId, deps]);

  return <StatusBadge status={status} />;
}
```

---

## URL State: Default State Store

Use the query string for:

- filters
- sorting
- pagination
- selected ids (where reasonable)
- tabs/view modes
- search terms

Avoid URL state for:

- secrets / tokens
- huge payloads
- high-frequency values (drag positions)
- ephemeral UI (hover, focus)
- temporary drafts (unless it's a feature)

> **Rule of thumb:** If changing it should create a navigable history entry, it belongs in the URL.

### URL state as a schema

- Centralize parsing + serialization.
- Components receive typed values, not raw strings.
- React Query keys derive from parsed URL state.
- **Use `safeParse`, not `parse`**: URL params are untrusted input. Fall back to schema defaults on invalid input rather than crashing the page (e.g., `?page=lol` → use default page 1).

### Example: Typed URL State with Zod

```ts
// lib/url-state.ts
import { z } from 'zod';

// Define the schema for URL parameters
export const productFiltersSchema = z
  .object({
    search: z.string().optional().default(''),
    category: z.enum(['all', 'electronics', 'clothing', 'home']).default('all'),
    sort: z.enum(['price-asc', 'price-desc', 'name', 'newest']).default('newest'),
    page: z.coerce.number().int().positive().default(1),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().positive().optional(),
  })
  .refine(
    (v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice,
    { message: 'minPrice must be <= maxPrice', path: ['maxPrice'] }
  );

export type ProductFilters = z.infer<typeof productFiltersSchema>;

// Export defaults for use in contexts/resets
export const defaultProductFilters = productFiltersSchema.parse({});

// Minimal interface for framework-agnostic parsing
// Works with URLSearchParams, ReadonlyURLSearchParams (Next.js), and custom implementations
type SearchParamsLike = { get(key: string): string | null };

// Parse URL search params into typed object
// Use safeParse -URL is untrusted input; don't crash the page on ?page=lol
export function parseProductFilters(searchParams: SearchParamsLike): ProductFilters {
  const result = productFiltersSchema.safeParse({
    search: searchParams.get('search') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    sort: searchParams.get('sort') ?? undefined,
    page: searchParams.get('page') ?? undefined,
    minPrice: searchParams.get('minPrice') ?? undefined,
    maxPrice: searchParams.get('maxPrice') ?? undefined,
  });

  // Fall back to defaults on invalid input (or log once for debugging)
  return result.success ? result.data : defaultProductFilters;
}

// Serialize typed object back to URL params (only non-default values)
export function serializeProductFilters(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams();
  const defaults = defaultProductFilters;

  if (filters.search && filters.search !== defaults.search) {
    params.set('search', filters.search);
  }
  if (filters.category !== defaults.category) {
    params.set('category', filters.category);
  }
  if (filters.sort !== defaults.sort) {
    params.set('sort', filters.sort);
  }
  if (filters.page !== defaults.page) {
    params.set('page', String(filters.page));
  }
  if (filters.minPrice !== undefined) {
    params.set('minPrice', String(filters.minPrice));
  }
  if (filters.maxPrice !== undefined) {
    params.set('maxPrice', String(filters.maxPrice));
  }

  return params;
}

// The keys this module controls -used for merging
const PRODUCT_FILTER_KEYS = ['search', 'category', 'sort', 'page', 'minPrice', 'maxPrice'] as const;

// Merge our params with existing URL (preserves unrelated params like feature flags)
export function mergeProductFilters(
  current: URLSearchParams,
  next: URLSearchParams
): URLSearchParams {
  const merged = new URLSearchParams(current);
  // Remove keys we control, then apply our new values
  PRODUCT_FILTER_KEYS.forEach((k) => merged.delete(k));
  next.forEach((v, k) => merged.set(k, v));
  return merged;
}
```

This merge pattern prevents "why did my query param disappear?" bugs when other widgets or feature flags use the URL.

```tsx
// ProductListContainer.tsx -uses typed URL state
import { useRouter, useSearchParams } from 'next/navigation';
import {
  parseProductFilters,
  serializeProductFilters,
  mergeProductFilters,
  type ProductFilters,
} from '@/lib/url-state';
import { useProductsQuery } from '@/queries/useProductsQuery';

export function ProductListContainer() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Parse once at the boundary -everything downstream is typed
  const filters = parseProductFilters(searchParams);

  // Query key derives from parsed state (stable, typed)
  const { data: products, isLoading } = useProductsQuery(filters);

  const updateFilters = (updates: Partial<ProductFilters>) => {
    const newFilters = { ...filters, ...updates };
    // Merge preserves other params (feature flags, other widgets)
    const params = mergeProductFilters(
      new URLSearchParams(searchParams.toString()),
      serializeProductFilters(newFilters)
    );
    router.push(`?${params.toString()}`);
  };

  return (
    <ProductListView
      products={products ?? []}
      filters={filters}
      isLoading={isLoading}
      handlers={{
        onSearch: (search) => updateFilters({ search, page: 1 }),
        onCategoryChange: (category) => updateFilters({ category, page: 1 }),
        onSortChange: (sort) => updateFilters({ sort }),
        onPageChange: (page) => updateFilters({ page }),
      }}
    />
  );
}
```

---

## State Modeling: "Units of Things That Happen Together"

- Avoid scattered booleans (`isLoading`, `isError`, `isEmpty`, `isSaving`…).
- Prefer discriminated unions for UI modes.
- Makes impossible states unrepresentable.

### Example: Discriminated Union for UI States

```ts
// ❌ BAD: Scattered booleans -allows impossible states
type BadFormState = {
  isSubmitting: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  data: User | null;
};
// What if isSubmitting AND isSuccess are both true? Impossible but expressible.
```

```ts
// ✅ GOOD: Discriminated union -impossible states are unrepresentable
type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error };

// Usage is exhaustive and type-safe
function renderFormState(state: FormState) {
  switch (state.status) {
    case 'idle':
      return <SubmitButton />;
    case 'submitting':
      return <SubmitButton disabled loading />;
    case 'success':
      return <SuccessMessage user={state.data} />;
    case 'error':
      return <ErrorMessage error={state.error} />;
  }
}
```

### Example: Multi-Step Workflow State

```ts
// Order checkout flow with explicit states
type CheckoutState =
  | { step: 'cart'; items: CartItem[] }
  | { step: 'shipping'; items: CartItem[]; shippingAddress: Address | null }
  | { step: 'payment'; items: CartItem[]; shippingAddress: Address; paymentMethod: PaymentMethod | null }
  | { step: 'confirming'; order: PendingOrder }
  | { step: 'complete'; order: ConfirmedOrder }
  | { step: 'failed'; error: CheckoutError; lastValidState: CheckoutState };

// State machine transitions are explicit
function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case 'SET_SHIPPING_ADDRESS':
      if (state.step !== 'shipping') return state;  // Guard invalid transitions
      return { ...state, shippingAddress: action.address };

    case 'PROCEED_TO_PAYMENT':
      if (state.step !== 'shipping' || !state.shippingAddress) return state;
      return {
        step: 'payment',
        items: state.items,
        shippingAddress: state.shippingAddress,
        paymentMethod: null,
      };

    // ... other transitions
  }
}
```

### Example: Modal/Dialog State

```ts
// ❌ BAD: Which dialog is open? What data does it have?
type BadState = {
  isEditDialogOpen: boolean;
  isDeleteDialogOpen: boolean;
  isConfirmDialogOpen: boolean;
  selectedUser: User | null;
  pendingAction: string | null;
};
```

```ts
// ✅ GOOD: One dialog at a time, data travels with state
type DialogState =
  | { type: 'closed' }
  | { type: 'editing'; user: User }
  | { type: 'confirming-delete'; user: User }
  | { type: 'viewing-details'; user: User };

// Usage
function UserTable({ users }: { users: User[] }) {
  const [dialog, setDialog] = useState<DialogState>({ type: 'closed' });

  return (
    <>
      <Table>
        {users.map((user) => (
          <Row
            key={user.id}
            user={user}
            onEdit={() => setDialog({ type: 'editing', user })}
            onDelete={() => setDialog({ type: 'confirming-delete', user })}
          />
        ))}
      </Table>

      {dialog.type === 'editing' && (
        <EditUserDialog
          user={dialog.user}
          onClose={() => setDialog({ type: 'closed' })}
        />
      )}

      {dialog.type === 'confirming-delete' && (
        <ConfirmDeleteDialog
          user={dialog.user}
          onConfirm={() => handleDelete(dialog.user.id)}
          onCancel={() => setDialog({ type: 'closed' })}
        />
      )}
    </>
  );
}
```

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

These are the house rules for React Query usage:

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
- Hydration is wiring -not architecture.

```tsx
// Next.js App Router example -prefetch at the route boundary
// app/users/[id]/page.tsx (this IS the container -lives in app/, not components/)
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

## Error Handling + Error Boundaries (Mandatory)

### Error Handling Layers

| Layer | Catches | Where | Example |
| ----- | ------- | ----- | ------- |
| **Route-level boundary** | SSR errors, render crashes, unhandled throws | `app/error.tsx` or layout wrapper | Page-level "Something went wrong" |
| **Feature-level boundary** | Component subtree failures | Around widgets, forms, complex features | "This widget failed to load" |
| **Query/mutation errors** | Async data failures | React Query `onError`, component state | Inline error messages, retry buttons |
| **Client islands** | Browser-only failures | Wrap interactive islands | Graceful degradation |

### Error Logging

```ts
// Where to log errors
const errorLogger = {
  // Route/feature boundaries -log to Sentry/etc
  boundary: (error: Error, info: React.ErrorInfo) => {
    captureException(error, { extra: { componentStack: info.componentStack } });
  },

  // Query errors -log only server/unexpected errors
  query: (error: Error) => {
    if (isNetworkError(error) || is5xxError(error)) {
      captureException(error);
    }
    // Don't log 4xx -those are expected (not found, validation, etc.)
  },

  // Mutation errors -show user-facing error; log unexpected errors (5xx, network)
  mutation: (error: Error, context: { action: string }) => {
    if (isNetworkError(error) || is5xxError(error)) {
      captureException(error, { extra: context });
    }
    // Don't log 4xx -those are expected (validation, not found, etc.)
  },
};
```

### Example: Error Boundary Component

```tsx
// components/ErrorBoundary.tsx
import { Component, type ReactNode, type ErrorInfo } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

### Example: Reusable Error States

```tsx
// components/ErrorState.tsx
// Icons from lucide-react, heroicons, or similar -swap as needed
import { AlertCircle as AlertCircleIcon } from 'lucide-react';

type ErrorStateProps = {
  title?: string;
  message?: string;
  error?: Error;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Something went wrong',
  message,
  error,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center" role="alert">
      <AlertCircleIcon className="h-12 w-12 text-red-500" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-gray-600">
        {message ?? error?.message ?? 'An unexpected error occurred.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

// components/EmptyState.tsx
import { type ReactNode } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
};

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      {icon ?? <InboxIcon className="h-12 w-12 text-gray-400" />}
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {message && <p className="mt-2 text-gray-600">{message}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

### Example: Error Boundary Usage

```tsx
// Layout with route-level error boundary
function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="flex min-h-screen items-center justify-center">
          <ErrorState
            title="Page Error"
            error={error}
            onRetry={reset}
          />
        </div>
      )}
      onError={(error, info) => {
        // Log to error tracking service
        errorTracker.capture(error, { componentStack: info.componentStack });
      }}
    >
      <Header />
      <main>{children}</main>
      <Footer />
    </ErrorBoundary>
  );
}

// Feature-level boundary
function DashboardPage() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <ErrorBoundary fallback={<WidgetErrorState widget="analytics" />}>
        <AnalyticsWidget />
      </ErrorBoundary>

      <ErrorBoundary fallback={<WidgetErrorState widget="notifications" />}>
        <NotificationsWidget />
      </ErrorBoundary>
    </div>
  );
}
```

### React Query + Suspense + ErrorBoundary

Since you're mandating both Suspense and boundaries, understand the key gotchas:

1. **Suspense only handles "pending", not "error"** -You still need an ErrorBoundary around Suspense subtrees
2. **React Query suspense mode throws during render** -Errors are caught by ErrorBoundary (good), but you need to reset queries when retrying

The canonical pattern:

```tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query';

function DataWidget() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={({ error, reset: resetBoundary }) => (
            <ErrorState
              error={error}
              onRetry={() => {
                reset();           // Reset React Query state
                resetBoundary();   // Reset ErrorBoundary state
              }}
            />
          )}
        >
          <Suspense fallback={<WidgetSkeleton />}>
            <WidgetContent />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

The `QueryErrorResetBoundary` ensures that when the user clicks "retry", the failed queries refetch instead of immediately re-throwing.

---

## Dependency Injection for Components (Handlers / Deps)

Components should accept typed "capabilities" via props, not imports of concrete side-effectful functions.

### The Distinction: handlers vs deps

Without a hard rule, teams will mix these inconsistently. Here's the pattern that scales:

| Prop      | Purpose                                    | Examples                                    |
|-----------|--------------------------------------------|---------------------------------------------|
| `handlers` | User-intent callbacks (UI events)          | `onDelete`, `onEdit`, `onSubmit`, `onSelect` |
| `deps`     | Capabilities/services (platform features)   | `nav`, `toast`, `track`, `clipboard`, `time` |

**Why this matters:** Storybook can provide dumb stubs for `deps`, while tests assert `handlers` calls. The split also makes it clear which props are "what happens" (handlers) vs "what tools exist" (deps).

```tsx
// Full DI pattern with both handlers and deps
import type { NavigationApi, ToastService, Analytics } from '@/lib/platform/ports';

type UserCardDeps = {
  nav: NavigationApi;
  toast: ToastService;
  track: Analytics['track'];
};

type UserCardHandlers = {
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
};

type UserCardProps = {
  user: User;
  deps: UserCardDeps;
  handlers: UserCardHandlers;
};
```

### What to Inject vs Import

**Inject** (anything that causes side effects):

- API clients
- navigation/router adapters
- analytics/events
- toasts/notifications
- clocks/timers
- websockets

**Import directly** (pure utilities):

- formatting functions
- pure data transforms
- static constants

### Example: Handlers Pattern

```tsx
// ❌ BAD: Component imports side-effectful functions directly
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { deleteUser } from '@/api/users';
import { trackEvent } from '@/analytics';

function UserCard({ user }: { user: User }) {
  const router = useRouter();

  const handleDelete = async () => {
    await deleteUser(user.id);
    trackEvent('user_deleted', { userId: user.id });
    toast.success('User deleted');
    router.push('/users');
  };

  return (
    <div>
      <span>{user.name}</span>
      <button onClick={handleDelete}>Delete</button>
    </div>
  );
}
// Testing this requires mocking 4 different modules
```

```tsx
// ✅ GOOD: Pure component with injected handlers and deps
// components/UserCard.tsx (pure)
import type { NavigationApi, ToastService, Analytics } from '@/lib/platform/ports';

type UserCardProps = {
  user: User;
  deps: { nav: NavigationApi; toast: ToastService; track: Analytics['track'] };
  handlers: { onDelete: (id: string) => Promise<void> };
};

export function UserCard({ user, deps, handlers }: UserCardProps) {
  return (
    <div className="rounded border p-4">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      <div className="mt-4 space-x-2">
        <button onClick={() => deps.nav.push(`/users/${user.id}`)}>View</button>
        <button onClick={() => deps.nav.push(`/users/${user.id}/edit`)}>Edit</button>
        <button onClick={() => handlers.onDelete(user.id)}>Delete</button>
      </div>
    </div>
  );
}

// Container wires the handlers at the framework boundary
// app/users/UserCardContainer.tsx (boundary -framework imports OK here)
'use client';

import { useRouter } from 'next/navigation';
import { createNavigationAdapter } from '@/adapters/navigation';
import { toast } from 'sonner';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserCard } from '@/components/UserCard';

export function UserCardContainer({ user }: { user: User }) {
  const nav = createNavigationAdapter(useRouter());
  const { mutateAsync } = useDeleteUserMutation();

  return (
    <UserCard
      user={user}
      deps={{
        nav,
        toast: { success: toast.success, error: toast.error },
        track: (event, data) => console.log('track', event, data),
      }}
      handlers={{
        onDelete: async (id) => {
          await mutateAsync(id);
          toast.success('User deleted');
          nav.push('/users');
        },
      }}
    />
  );
}
```

### Example: Testing with Injected Handlers

```tsx
// UserCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserCard, type UserCardHandlers } from './UserCard';

describe('UserCard', () => {
  const mockUser: User = {
    id: '123',
    name: 'Alice',
    email: 'alice@example.com',
  };

  const createMockHandlers = (): UserCardHandlers => ({
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onView: vi.fn(),
  });

  it('calls onDelete when delete button is clicked', async () => {
    const handlers = createMockHandlers();
    render(<UserCard user={mockUser} handlers={handlers} />);

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(handlers.onDelete).toHaveBeenCalledWith('123');
  });

  it('calls onEdit when edit button is clicked', async () => {
    const handlers = createMockHandlers();
    render(<UserCard user={mockUser} handlers={handlers} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(handlers.onEdit).toHaveBeenCalledWith('123');
  });
});
```

---

## Avoid Prop Drilling (Use Context Properly)

- Use Context to **group cohesive feature subtrees**, not to create a global dumping ground.
- Context surface should be small: `{ state, actions }` or `{ handlers }`
- If it grows, split providers by concern (filters vs selection vs permissions).

### Example: Feature-Scoped Context

```tsx
// contexts/ProductFilterContext.tsx
import { createContext, useContext, useState, type ReactNode } from 'react';
import { defaultProductFilters, type ProductFilters } from '@/lib/url-state';

type ProductFilterContextValue = {
  filters: ProductFilters;
  updateFilters: (updates: Partial<ProductFilters>) => void;
  resetFilters: () => void;
};

const ProductFilterContext = createContext<ProductFilterContextValue | null>(null);

export function useProductFilters() {
  const context = useContext(ProductFilterContext);
  if (!context) {
    throw new Error('useProductFilters must be used within ProductFilterProvider');
  }
  return context;
}

type ProductFilterProviderProps = {
  initialFilters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
  children: ReactNode;
};

export function ProductFilterProvider({
  initialFilters,
  onFiltersChange,
  children,
}: ProductFilterProviderProps) {
  const [filters, setFilters] = useState(initialFilters);

  const updateFilters = (updates: Partial<ProductFilters>) => {
    const newFilters = { ...filters, ...updates };
    setFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const resetFilters = () => {
    setFilters(defaultProductFilters);
    onFiltersChange(defaultProductFilters);
  };

  return (
    <ProductFilterContext.Provider value={{ filters, updateFilters, resetFilters }}>
      {children}
    </ProductFilterContext.Provider>
  );
}
```

```tsx
// Deep child can access filters without prop drilling
function PriceRangeFilter() {
  const { filters, updateFilters } = useProductFilters();

  return (
    <div>
      <input
        type="number"
        value={filters.minPrice ?? ''}
        onChange={(e) => updateFilters({ minPrice: Number(e.target.value) })}
        placeholder="Min price"
      />
      <input
        type="number"
        value={filters.maxPrice ?? ''}
        onChange={(e) => updateFilters({ maxPrice: Number(e.target.value) })}
        placeholder="Max price"
      />
    </div>
  );
}
```

### Example: Split Contexts by Concern

```tsx
// ❌ BAD: God context with everything
const AppContext = createContext<{
  user: User | null;
  theme: Theme;
  filters: Filters;
  selection: Set<string>;
  notifications: Notification[];
  permissions: Permissions;
  // ... 20 more fields
} | null>(null);
```

```tsx
// ✅ GOOD: Split by concern
// Each context is small, focused, and changes independently
<AuthProvider>          {/* user, permissions */}
  <ThemeProvider>       {/* theme, setTheme */}
    <NotificationProvider>  {/* notifications, addNotification, dismiss */}
      <App />
    </NotificationProvider>
  </ThemeProvider>
</AuthProvider>

// Feature-level providers at route boundaries
<ProductFilterProvider>
  <ProductSelectionProvider>
    <ProductCatalogPage />
  </ProductSelectionProvider>
</ProductFilterProvider>
```

---

## Custom Hooks Patterns

### When to Extract a Hook

Extract a hook when:

1. **Reuse** -The same stateful logic appears in multiple components
2. **Complexity** -A component's logic is hard to follow
3. **Testing** -You want to test the logic separately from the UI

Don't extract a hook just to "organize code." If it's only used once and the component is readable, leave it inline.

### Naming Conventions

| Pattern | Example | Use for |
| ------- | ------- | ------- |
| `use{Thing}` | `useDebounce`, `useLocalStorage` | Primitive utilities |
| `use{Thing}Query` | `useUserQuery`, `useProductsQuery` | React Query wrappers |
| `use{Thing}Mutation` | `useUpdateUserMutation` | React Query mutations |
| `use{Thing}State` | `useFormState`, `useDialogState` | Local state management |
| `use{Feature}` | `useCheckout`, `useAuth` | Feature-specific composition |

### Primitive Hooks (Reusable Utilities)

These are small, focused, and widely reusable:

```tsx
// hooks/useDebounce.ts
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
```

```tsx
// hooks/useLocalStorage.ts
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    setStoredValue(valueToStore);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    }
  };

  return [storedValue, setValue];
}
```

```tsx
// hooks/useMediaQuery.ts
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

// Usage
const isMobile = useMediaQuery('(max-width: 768px)');
```

### Composition Pattern

Compose primitive hooks into feature-specific hooks. **Note:** Framework-aware logic (like reading URL params) should be injected as deps, not imported -this keeps hooks portable and testable:

```tsx
// hooks/useSearchFilter.ts -composes primitives, accepts deps
import { useState } from 'react';
import { useDebounce } from './useDebounce';

type UseSearchFilterDeps = {
  getInitialValue: () => string;  // Injected by caller
};

export function useSearchFilter(deps: UseSearchFilterDeps) {
  const [inputValue, setInputValue] = useState(deps.getInitialValue);

  // Debounced for performance
  const debouncedValue = useDebounce(inputValue, 300);

  return {
    inputValue,
    setInputValue,
    debouncedValue,
    isEmpty: debouncedValue.length === 0,
  };
}

// Usage in a Next.js container (framework boundary):
// const searchParams = useSearchParams();
// const filter = useSearchFilter({
//   getInitialValue: () => searchParams.get('search') ?? '',
// });
```

### State Machine Hooks

For complex state transitions, encapsulate in a hook:

```tsx
// hooks/useDialogState.ts
import { useState, useCallback } from 'react';

type DialogState<T> =
  | { type: 'closed' }
  | { type: 'open'; data: T };

export function useDialogState<T>() {
  const [state, setState] = useState<DialogState<T>>({ type: 'closed' });

  const open = useCallback((data: T) => {
    setState({ type: 'open', data });
  }, []);

  const close = useCallback(() => {
    setState({ type: 'closed' });
  }, []);

  return {
    isOpen: state.type === 'open',
    data: state.type === 'open' ? state.data : null,
    open,
    close,
  };
}

// Usage
function UserTable({ users }: { users: User[] }) {
  const editDialog = useDialogState<User>();

  return (
    <>
      {users.map((user) => (
        <button key={user.id} onClick={() => editDialog.open(user)}>
          Edit {user.name}
        </button>
      ))}

      {editDialog.isOpen && editDialog.data && (
        <EditUserDialog user={editDialog.data} onClose={editDialog.close} />
      )}
    </>
  );
}
```

### Testing Custom Hooks

Use `renderHook` from React Testing Library:

```tsx
// hooks/useCounter.test.ts
import { renderHook, act } from '@testing-library/react';
import { useCounter } from './useCounter';

describe('useCounter', () => {
  it('initializes with default value', () => {
    const { result } = renderHook(() => useCounter());
    expect(result.current.count).toBe(0);
  });

  it('increments count', () => {
    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);
  });

  it('accepts initial value', () => {
    const { result } = renderHook(() => useCounter(10));
    expect(result.current.count).toBe(10);
  });
});
```

### Anti-Patterns to Avoid

```tsx
// ❌ BAD: "Kitchen sink" hook that does too much
function useUserPage(userId: string) {
  const user = useUserQuery(userId);
  const posts = useUserPostsQuery(userId);
  const followers = useFollowersQuery(userId);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedTab, setSelectedTab] = useState('posts');
  const updateUser = useUpdateUserMutation();
  const deleteUser = useDeleteUserMutation();
  // ... 20 more things

  return {
    user, posts, followers, isEditing, setIsEditing,
    selectedTab, setSelectedTab, updateUser, deleteUser, /* ... */
  };
}
```

```tsx
// ✅ GOOD: Keep hooks focused, compose at component level
function UserPage({ userId }: { userId: string }) {
  // Compose focused hooks in the component
  const { data: user } = useUserQuery(userId);
  const { data: posts } = useUserPostsQuery(userId);
  const editDialog = useDialogState<User>();
  const [selectedTab, setSelectedTab] = useState<Tab>('posts');

  // Clear what's happening at a glance
  return (/* ... */);
}
```

### Hooks Decision Guide

| Situation | Action |
| --------- | ------ |
| Same stateful logic in 3+ components | Extract a hook |
| Complex state machine | Extract a hook |
| Logic is one-liner | Keep inline |
| Only used in one component, readable | Keep inline |
| Need to test logic separately | Extract a hook |
| Wrapping React Query | Extract `use{Thing}Query` hook |

---

## React 19 Defaults Before Adding More Libraries

> **Policy:** Prefer React primitives (`useTransition`, `useOptimistic`, `useActionState`) before adding global state libraries. React Query handles server state; only add Zustand/Redux when you have proven cross-tree synchronization needs.

**Decision tree:**

| Need | Solution |
| ---- | -------- |
| Server state (fetch, cache, sync) | React Query |
| Non-blocking UI updates | `useTransition` |
| Optimistic UI | `useOptimistic` |
| Form submission state | `useActionState` |
| Local component state | `useState` / `useReducer` |
| Shared within feature subtree | React Context |
| Proven cross-tree sync | Zustand (only after measuring) |

### Example: useTransition for Non-Blocking Updates

```tsx
// Search with non-blocking filter updates
function ProductSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSearch = (value: string) => {
    // Update input immediately (high priority)
    setSearchTerm(value);

    // Mark filter update as low priority (won't block typing)
    startTransition(() => {
      updateFilters({ search: value });
    });
  };

  return (
    <div className="relative">
      <input
        value={searchTerm}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search products..."
        className="w-full rounded border p-2"
      />
      {isPending && (
        <div className="absolute right-2 top-2">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
```

### Example: useOptimistic for Instant Feedback

```tsx
// Optimistic like button
function LikeButton({ postId, initialLikes, isLiked }: LikeButtonProps) {
  const [optimisticState, addOptimistic] = useOptimistic(
    { likes: initialLikes, isLiked },
    (state, action: 'like' | 'unlike') => ({
      likes: action === 'like' ? state.likes + 1 : Math.max(0, state.likes - 1),
      isLiked: action === 'like' ? true : false,
    })
  );

  const toggleLike = async () => {
    const action = optimisticState.isLiked ? 'unlike' : 'like';

    // Update UI immediately
    addOptimistic(action);

    // Then sync with server
    await fetch(`/api/posts/${postId}/like`, {
      method: optimisticState.isLiked ? 'DELETE' : 'POST',
    });
  };

  return (
    <button onClick={toggleLike} className="flex items-center gap-2">
      <HeartIcon filled={optimisticState.isLiked} />
      <span>{optimisticState.likes}</span>
    </button>
  );
}
```

### Example: useActionState for Form Submissions

```tsx
// Form with action state (React 19)
function ContactForm() {
  const [state, submitAction, isPending] = useActionState(
    async (_prevState: FormState, formData: FormData) => {
      const result = await submitContactForm(formData);
      if (result.success) {
        return { status: 'success' as const, message: 'Message sent!' };
      }
      return { status: 'error' as const, message: result.error };
    },
    { status: 'idle' as const }
  );

  return (
    <form action={submitAction}>
      <input name="email" type="email" required />
      <textarea name="message" required />

      <button type="submit" disabled={isPending}>
        {isPending ? 'Sending...' : 'Send'}
      </button>

      {state.status === 'success' && (
        <p className="text-green-600">{state.message}</p>
      )}
      {state.status === 'error' && (
        <p className="text-red-600">{state.message}</p>
      )}
    </form>
  );
}
```

Add global state libraries only when:

- you have proven cross-tree synchronization needs
- React Context becomes too large or too frequently updated
- performance issues are real and measured

---

## Form Handling Patterns

Forms are validation boundaries. Use React Hook Form for form state + Zod for schema validation. This keeps business functions clean and forms performant.

### Required Stack

```bash
npm install react-hook-form @hookform/resolvers zod
```

### Basic Pattern: Form + Zod Schema

```tsx
// schemas/contact.ts -single source of truth
import { z } from 'zod';

export const contactFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;
```

```tsx
// components/ContactForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contactFormSchema, type ContactFormData } from '@/schemas/contact';

type ContactFormProps = {
  onSubmit: (data: ContactFormData) => Promise<void>;
  defaultValues?: Partial<ContactFormData>;
};

export function ContactForm({ onSubmit, defaultValues }: ContactFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      priority: 'medium',
      ...defaultValues,
    },
  });

  const handleFormSubmit = async (data: ContactFormData) => {
    await onSubmit(data);
    reset();  // Clear form on success
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      <div>
        <label htmlFor="name">Name</label>
        <input id="name" {...register('name')} aria-invalid={!!errors.name} />
        {errors.name && <span role="alert">{errors.name.message}</span>}
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" {...register('email')} aria-invalid={!!errors.email} />
        {errors.email && <span role="alert">{errors.email.message}</span>}
      </div>

      <div>
        <label htmlFor="message">Message</label>
        <textarea id="message" {...register('message')} aria-invalid={!!errors.message} />
        {errors.message && <span role="alert">{errors.message.message}</span>}
      </div>

      <div>
        <label htmlFor="priority">Priority</label>
        <select id="priority" {...register('priority')}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}
```

### Field Components for Reuse

Extract field rendering into reusable components:

```tsx
// components/form/FormField.tsx
import { type FieldError } from 'react-hook-form';

type FormFieldProps = {
  label: string;
  name: string;
  error?: FieldError;
  children: React.ReactNode;
};

export function FormField({ label, name, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
```

```tsx
// Usage in form
<FormField label="Email" name="email" error={errors.email}>
  <input
    id="email"
    type="email"
    {...register('email')}
    className={cn('input', errors.email && 'border-red-500')}
    aria-invalid={!!errors.email}
  />
</FormField>
```

### Controlled Fields (When Needed)

Most fields should be uncontrolled (via `register`). Use `Controller` only when the component requires controlled props:

```tsx
// For third-party components that don't accept ref
import { Controller, useForm } from 'react-hook-form';
import { DatePicker } from '@/components/DatePicker';

function EventForm() {
  const { control, handleSubmit } = useForm<EventFormData>();

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Regular inputs -uncontrolled via register */}
      <input {...register('title')} />

      {/* DatePicker needs controlled -use Controller */}
      <Controller
        name="startDate"
        control={control}
        render={({ field, fieldState }) => (
          <DatePicker
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
    </form>
  );
}
```

### Server Errors + Field Errors

Handle both client validation and server-side errors:

```tsx
function RegistrationForm({ onSubmit }: RegistrationFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationData>({
    resolver: zodResolver(registrationSchema),
  });

  const handleFormSubmit = async (data: RegistrationData) => {
    const result = await onSubmit(data);

    if (!result.success) {
      // Map server errors to specific fields
      if (result.error.code === 'EMAIL_TAKEN') {
        setError('email', { message: 'This email is already registered' });
        return;
      }

      // Generic form-level error
      setError('root', { message: result.error.message });
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)}>
      {errors.root && (
        <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">
          {errors.root.message}
        </div>
      )}

      {/* Field inputs... */}
    </form>
  );
}
```

### Form with React Query Mutation

Wire forms to mutations for full server integration:

```tsx
// Container wires mutation to form
function CreateUserContainer() {
  const createUserMutation = useCreateUserMutation();

  const handleSubmit = async (data: CreateUserData) => {
    await createUserMutation.mutateAsync(data);
    toast.success('User created!');
    router.push('/users');
  };

  return (
    <CreateUserForm
      onSubmit={handleSubmit}
      isSubmitting={createUserMutation.isPending}
      serverError={createUserMutation.error?.message}
    />
  );
}

// Form stays pure -receives handlers via props
function CreateUserForm({ onSubmit, isSubmitting, serverError }: CreateUserFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<CreateUserData>({
    resolver: zodResolver(createUserSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {serverError && <FormError message={serverError} />}
      {/* Fields... */}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
```

### Form Patterns Summary

| Need | Solution |
| ---- | -------- |
| Form state | React Hook Form (`useForm`) |
| Validation | Zod schema + `zodResolver` |
| Simple inputs | `register('fieldName')` (uncontrolled) |
| Complex components | `Controller` (controlled) |
| Field errors | `formState.errors.fieldName` |
| Server errors | `setError('root', ...)` or `setError('fieldName', ...)` |
| Submission state | `formState.isSubmitting` or mutation `isPending` |
| Default values | `useForm({ defaultValues })` |

---

## React Server Components (RSC)

> **Note:** This section applies to frameworks that support RSC (Next.js App Router, etc.). **If your framework doesn't support RSC (Vite SPA, CRA, older Next.js), skip this section** -the Container/View pattern from earlier sections is your model. RSC just moves the Container to the server.

### RSC Mental Model

| Component Type | Where it runs | What it does | Can use |
| -------------- | ------------- | ------------ | ------- |
| **Server Component** (default) | Server only | Fetch data, access DB, read files | async/await, server-only APIs |
| **Client Component** (`'use client'`) | Server + Client | Interactivity, hooks, browser APIs | useState, useEffect, event handlers |

### How RSC Fits Container/View

The Container/View split maps directly:

```text
Traditional SPA:
  Container (client) → fetches data → passes to View (client)

With RSC:
  Server Component → fetches data → passes to View (client or server)
```

```tsx
// app/users/[id]/page.tsx -Server Component (Container role)
// Next.js App Router example: uses notFound(); other frameworks should use their equivalent 404 mechanism (throw/return boundary response).
// This runs on the server only
import { notFound } from 'next/navigation';
import { UserProfileView } from '@/components/UserProfileView';
import { fetchUser } from '@/data/users';

export default async function UserPage({ params }: { params: { id: string } }) {
  // Direct data access -no useEffect, no loading states here
  const user = await fetchUser(params.id);

  if (!user) {
    notFound();
  }

  // Pass data to View (can be Server or Client Component)
  return <UserProfileView user={user} />;
}
```

```tsx
// components/UserProfileView.tsx -View (Server Component by default)
// No 'use client' needed if no interactivity
type UserProfileViewProps = {
  user: User;
};

export function UserProfileView({ user }: UserProfileViewProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{user.name}</h1>
      <p className="text-gray-600">{user.email}</p>
      {/* Static content -no client JS needed */}
    </div>
  );
}
```

### When to Add 'use client'

Add `'use client'` only when the component needs:

- **Event handlers** (`onClick`, `onChange`, `onSubmit`)
- **Hooks** (`useState`, `useEffect`, `useContext`, `useRef`)
- **Browser APIs** (`window`, `localStorage`, `IntersectionObserver`)
- **Third-party client libraries** (that use hooks internally)

```tsx
// components/UserActions.tsx -needs 'use client'
'use client';

import { useState } from 'react';

type UserActionsProps = {
  userId: string;
  onDelete: (id: string) => Promise<void>;
};

export function UserActions({ userId, onDelete }: UserActionsProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete(userId);
    // Navigation happens in Server Action or parent
  };

  return (
    <button onClick={handleDelete} disabled={isDeleting}>
      {isDeleting ? 'Deleting...' : 'Delete'}
    </button>
  );
}
```

### Composing Server and Client Components

Server Components can import Client Components. Client Components cannot import Server Components (but can accept them as children).

```tsx
// app/dashboard/page.tsx -Server Component
import { DashboardStats } from '@/components/DashboardStats';  // Server
import { LiveNotifications } from '@/components/LiveNotifications';  // Client
import { fetchStats } from '@/data/dashboard';

export default async function DashboardPage() {
  const stats = await fetchStats();

  return (
    <div className="grid gap-4">
      {/* Server Component -rendered on server, no client JS */}
      <DashboardStats stats={stats} />

      {/* Client Component -hydrated on client for interactivity */}
      <LiveNotifications userId={stats.userId} />
    </div>
  );
}
```

```tsx
// Passing Server Components as children to Client Components
// app/layout.tsx
import { ThemeProvider } from '@/providers/ThemeProvider';  // Client
import { Header } from '@/components/Header';  // Server

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {/* Client Component wrapper, but Header stays Server Component */}
        <ThemeProvider>
          <Header />  {/* Passed as children -stays server-rendered */}
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### Data Fetching in RSC

Fetch directly in Server Components. No `useEffect`, no loading state management at this level:

```tsx
// Direct async/await in component body
export default async function ProductsPage() {
  const products = await db.products.findMany();  // Direct DB access

  return <ProductGrid products={products} />;
}
```

For loading states, use Suspense at the layout level:

```tsx
// app/products/loading.tsx -automatic Suspense boundary
export default function ProductsLoading() {
  return <ProductGridSkeleton />;
}
```

### RSC + React Query

> **When to use each:** Server Components fetch directly (no React Query needed). React Query is for client-side cache, mutations, and real-time updates.

React Query is still valuable in RSC apps for:

- Client-side mutations
- Optimistic updates
- Real-time refetching
- Prefetching with hydration

```tsx
// Server Component -prefetch for hydration
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { productKeys } from '@/queries/productKeys';

export default async function ProductPage({ params }: { params: { id: string } }) {
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: productKeys.detail(params.id),
    queryFn: () => fetchProduct(params.id),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductDetailContainer productId={params.id} />
    </HydrationBoundary>
  );
}

// Client Component -uses prefetched data, handles mutations
'use client';

function ProductDetailContainer({ productId }: { productId: string }) {
  const { data: product } = useProductQuery(productId);  // Instant from cache
  const updateMutation = useUpdateProductMutation();

  // ...
}
```

### RSC Decision Guide

| Scenario | Component Type |
| -------- | -------------- |
| Static content, no interactivity | Server Component |
| Data fetching for page | Server Component |
| Event handlers needed | Client Component |
| useState/useEffect needed | Client Component |
| Third-party UI library (uses hooks) | Client Component |
| Form with validation | Client Component |
| Real-time updates (websocket) | Client Component |
| Pure display of server-fetched data | Server Component |

---

## Tailwind Styling Rules

- Tailwind is the default styling system.
- Favor composability:
  - components accept `className`
  - expose slots/props instead of hardcoding variants everywhere
- Keep UI framework-agnostic:
  - no framework-specific CSS dependencies
  - no SSR-only assumptions inside presentational components

### Example: Composable Button with Variants

```tsx
// components/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base styles
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        ghost: 'hover:bg-gray-100',
        link: 'text-blue-600 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    isLoading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  isLoading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Spinner className="mr-2 h-4 w-4" />}
      {children}
    </button>
  );
}
```

```tsx
// Usage -className for one-off overrides
<Button variant="primary" size="lg">
  Submit
</Button>

<Button variant="ghost" className="text-red-500">
  Cancel
</Button>
```

---

## Show Don't Tell: Storybook-First Development

> **Philosophy:** Get feature flows working in Storybook before wiring to real backends. Shorter inspect-and-adapt loops. Faster feedback cycles. Stakeholders can see working UI before the API exists.

### Why Storybook-First?

| Traditional Approach | Storybook-First |
| -------------------- | --------------- |
| Build backend → Build frontend → Demo | Build stories with MSW → Demo → Build backend in parallel |
| Feedback after full integration | Feedback on UI/UX immediately |
| Bugs found late | Bugs found early |
| Stakeholder review at end | Stakeholder review throughout |

### Feature Flow Storyboards

For multi-step features (checkout, onboarding, wizards), create **storyboard stories** that demonstrate the entire flow:

```tsx
// features/checkout/Checkout.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { http, HttpResponse, delay } from 'msw';

const meta: Meta<typeof CheckoutFlow> = {
  title: 'Flows/Checkout',
  component: CheckoutFlow,
  parameters: {
    layout: 'fullscreen',
    // MSW handlers for the entire flow
    msw: { handlers: checkoutHandlers },
  },
};

export default meta;

// Individual step stories for isolated testing
export const Step1_Cart: Story = {};
export const Step2_Shipping: Story = { args: { initialStep: 'shipping' } };
export const Step3_Payment: Story = { args: { initialStep: 'payment' } };
export const Step4_Confirmation: Story = { args: { initialStep: 'confirmation' } };

// Full flow story with play function -the "storyboard"
export const FullCheckoutFlow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Step 1: Review cart
    await expect(canvas.getByText(/your cart/i)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /proceed to checkout/i }));

    // Step 2: Enter shipping
    await userEvent.type(canvas.getByLabelText(/street/i), '123 Main St');
    await userEvent.type(canvas.getByLabelText(/city/i), 'Portland');
    await userEvent.click(canvas.getByRole('button', { name: /continue to payment/i }));

    // Step 3: Enter payment
    await userEvent.type(canvas.getByLabelText(/card number/i), '4242424242424242');
    await userEvent.click(canvas.getByRole('button', { name: /place order/i }));

    // Step 4: Confirmation
    await expect(canvas.getByText(/order confirmed/i)).toBeInTheDocument();
  },
};

// Edge case flows
export const PaymentDeclined: Story = {
  parameters: {
    msw: {
      handlers: [
        ...checkoutHandlers,
        http.post('/api/orders', () => HttpResponse.json({ error: 'Card declined' }, { status: 402 })),
      ],
    },
  },
};
```

### Development Workflow

1. **Sketch the flow** -Create empty stories for each step
2. **Build views** -Implement `StepView` components with mock props
3. **Add MSW handlers** -Simulate API responses
4. **Demo to stakeholders** -Get feedback before backend is ready
5. **Wire to real backend** -Replace MSW with real API
6. **Keep stories** -They become regression tests

This approach enables **parallel frontend/backend development** and catches UX issues before they're expensive to fix.

---

## Storybook: Required for Every Component

Rules:

- Every component must have a paired story.
- Stories must cover key variants: default, loading, empty, error, edge cases
- Stories should use DI handlers (fake actions).
- For data-driven components, use MSW (required) to mock API responses.

Storybook is your:

- component catalog
- regression surface
- living documentation
- **stakeholder demo environment**

### Example: Basic Story Structure

```tsx
// UserCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { UserCard } from './UserCard';

const meta: Meta<typeof UserCard> = {
  title: 'Components/UserCard',
  component: UserCard,
  args: {
    handlers: {
      onEdit: fn(),
      onDelete: fn(),
      onView: fn(),
    },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
};

export default meta;
type Story = StoryObj<typeof UserCard>;

export const Default: Story = {
  args: {
    user: {
      id: '1',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      avatar: 'https://i.pravatar.cc/150?u=alice',
    },
  },
};

export const LongName: Story = {
  args: {
    user: {
      id: '2',
      name: 'Alexandria Bartholomew Constantine III',
      email: 'alexandria.bartholomew.constantine.iii@verylongemaildomain.com',
    },
  },
};

export const NoAvatar: Story = {
  args: {
    user: {
      id: '3',
      name: 'Bob Smith',
      email: 'bob@example.com',
    },
  },
};
```

### Example: Story with MSW for Data Fetching

For framework-agnostic Storybook stories, create a portable container that accepts props instead of reading from router params:

```tsx
// UserProfileByIdContainer.tsx -portable container (no useParams)
'use client';

import { createNavigationAdapter } from '@/adapters/navigation';
import { useUserQuery } from '@/queries/useUserQuery';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserProfileView } from './UserProfileView';

// Portable container: accepts userId and handlers as props (works in Storybook, tests, any framework)
export function UserProfileByIdContainer({
  userId,
  handlers,
}: {
  userId: string;
  handlers: { onEdit: () => void; onDelete: () => void };
}) {
  const { data: user, isLoading, error } = useUserQuery(userId);

  if (isLoading) return <UserProfileSkeleton />;
  if (error) return <ErrorState error={error} />;
  if (!user) return <EmptyState title="User not found" />;

  return <UserProfileView user={user} handlers={handlers} />;
}

// Framework boundary container (app/users/[id]/UserProfileContainer.tsx)
// This lives in app/ and uses framework-specific hooks
'use client';

import { useParams, useRouter } from 'next/navigation';
import { createNavigationAdapter } from '@/adapters/navigation';
import { useDeleteUserMutation } from '@/queries/useDeleteUserMutation';
import { UserProfileByIdContainer } from './UserProfileByIdContainer';

export function UserProfileContainer() {
  const { id } = useParams<{ id: string }>();
  const nav = createNavigationAdapter(useRouter());
  const deleteUserMutation = useDeleteUserMutation();

  const handlers = {
    onEdit: () => nav.push(`/users/${id}/edit`),
    onDelete: () => deleteUserMutation.mutate(id),
  };

  return <UserProfileByIdContainer userId={id} handlers={handlers} />;
}
```

```tsx
// UserProfile.stories.tsx -framework-agnostic (no router addons needed)
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { http, HttpResponse, delay } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfileByIdContainer } from './UserProfileByIdContainer';

const mockUser = {
  id: '123',
  name: 'Alice Johnson',
  email: 'alice@example.com',
  role: 'admin',
};

const meta: Meta<typeof UserProfileByIdContainer> = {
  title: 'Features/UserProfile',
  component: UserProfileByIdContainer,
  decorators: [
    (Story) => {
      // Memoize QueryClient to prevent cache reset on rerender
      const [queryClient] = React.useState(
        () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
      );
      return (
        <QueryClientProvider client={queryClient}>
          {Story()}
        </QueryClientProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof UserProfileByIdContainer>;

export const Default: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', () => {
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};

export const Loading: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', async () => {
          await delay('infinite');
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};

export const Error: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', () => {
          return HttpResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }),
      ],
    },
  },
};

export const SlowResponse: Story = {
  args: {
    userId: '123',
    handlers: { onEdit: fn(), onDelete: fn() },
  },
  argTypes: {
    handlers: { table: { disable: true } },
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/users/:id', async () => {
          await delay(2000);
          return HttpResponse.json(mockUser);
        }),
      ],
    },
  },
};
```

### Example: Interactive Story with Play Function

```tsx
// LoginForm.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { LoginForm } from './LoginForm';

const meta: Meta<typeof LoginForm> = {
  title: 'Forms/LoginForm',
  component: LoginForm,
  args: {
    onSubmit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LoginForm>;

export const Default: Story = {};

export const FilledForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123');
  },
};

export const SubmissionFlow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Fill the form
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123');

    // Submit
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));

    // Verify handler was called with correct data
    await expect(args.onSubmit).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'password123',
    });
  },
};

export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Submit without filling form
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));

    // Check for validation errors
    await expect(canvas.getByText(/email is required/i)).toBeInTheDocument();
    await expect(canvas.getByText(/password is required/i)).toBeInTheDocument();
  },
};
```

---

## Testing Philosophy: Only When It Pays

- **Unit test** pure domain logic heavily.
- **Component tests** only where valuable:
  - complex UI logic
  - high-risk flows
  - historically flaky/buggy components
- **E2E tests** for critical user journeys.
- Prefer story-driven interaction tests for UI behaviors.

Avoid low-value tests:

- snapshot spam
- shallow render tests that assert implementation details
- tests that duplicate type checking

### Example: Testing Pure Domain Logic

```ts
// domain/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { calculateDiscount, calculateTotal } from './pricing';

describe('calculateDiscount', () => {
  it('applies percentage discount correctly', () => {
    expect(calculateDiscount(100, { type: 'percentage', value: 20 })).toBe(80);
  });

  it('applies fixed discount correctly', () => {
    expect(calculateDiscount(100, { type: 'fixed', value: 15 })).toBe(85);
  });

  it('does not allow negative totals', () => {
    expect(calculateDiscount(10, { type: 'fixed', value: 50 })).toBe(0);
  });

  it('handles edge case: 100% discount', () => {
    expect(calculateDiscount(100, { type: 'percentage', value: 100 })).toBe(0);
  });
});

describe('calculateTotal', () => {
  it('sums items correctly', () => {
    const items = [
      { price: 10, quantity: 2 },
      { price: 15, quantity: 1 },
    ];
    expect(calculateTotal(items)).toBe(35);
  });

  it('returns 0 for empty cart', () => {
    expect(calculateTotal([])).toBe(0);
  });
});
```

### Example: Component Test for Complex Logic

```tsx
// Only test components with non-trivial logic
// MultiStepForm.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiStepForm } from './MultiStepForm';

describe('MultiStepForm', () => {
  it('progresses through steps correctly', async () => {
    const onComplete = vi.fn();
    render(<MultiStepForm onComplete={onComplete} />);

    // Step 1: Personal Info
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/name/i), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 2: Address
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/street/i), '123 Main St');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 3: Review
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/123 main st/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onComplete).toHaveBeenCalledWith({
      name: 'Alice',
      street: '123 Main St',
    });
  });

  it('allows going back to previous steps', async () => {
    render(<MultiStepForm onComplete={vi.fn()} />);

    // Go to step 2
    await userEvent.type(screen.getByLabelText(/name/i), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Go back
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('Alice'); // Data preserved
  });
});
```

---

## MSW + Vite

### MSW: Required for Storybook and Integration Tests

MSW is not optional -it's how we get deterministic stories and tests.

| Use Case | MSW Role |
| -------- | -------- |
| Storybook (data-fetching stories) | Required. No real network in stories. |
| Storybook (pure presentational) | Not needed if no fetch occurs. |
| Integration tests | Required. Simulate edge cases deterministically. |
| Local dev "mock mode" | Optional but useful for offline/backend-less dev. |
| Production | Never. |

### Example: MSW Handler Setup

```ts
// mocks/handlers.ts
import { http, HttpResponse, delay } from 'msw';
import type { User, Product } from '@/types';

// Mock data -use incrementing IDs for deterministic tests
let nextId = 3;
let users: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

// Reset between tests/stories to prevent state leakage
export function resetMockDb() {
  nextId = 3;
  users = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
}

export const handlers = [
  // List users
  http.get('/api/users', () => {
    return HttpResponse.json(users);
  }),

  // Get single user
  http.get('/api/users/:id', ({ params }) => {
    const user = users.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json(user);
  }),

  // Create user -deterministic ID for tests
  http.post('/api/users', async ({ request }) => {
    const body = await request.json() as Omit<User, 'id'>;
    const newUser = { ...body, id: String(nextId++) };
    users.push(newUser);
    return HttpResponse.json(newUser, { status: 201 });
  }),

  // Delete user
  http.delete('/api/users/:id', ({ params }) => {
    const index = users.findIndex((u) => u.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    users.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];

// Edge case handlers for testing
export const errorHandlers = {
  serverError: http.get('/api/users', () => {
    return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
  }),

  slowResponse: http.get('/api/users', async () => {
    await delay(3000);
    return HttpResponse.json(users);
  }),

  networkError: http.get('/api/users', () => {
    return HttpResponse.error();
  }),
};
```

```ts
// Usage: call resetMockDb() to prevent state leakage
// In tests (vitest/jest):
afterEach(() => { resetMockDb(); });

// In Storybook decorator:
decorators: [(Story) => { resetMockDb(); return Story(); }]
```

```ts
// mocks/browser.ts -for Storybook
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

```ts
// mocks/server.ts -for tests
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

```ts
// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';
import { resetMockDb } from './mocks/handlers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();  // Reset to default handlers
  resetMockDb();           // Reset mock data to prevent test leakage
});
afterAll(() => server.close());
```

### Storybook One-Time Setup (preview.ts)

Teams need the canonical wiring file so every story automatically gets MSW + deterministic resets:

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { handlers, resetMockDb } from '../src/mocks/handlers';

// Initialize MSW
initialize({ onUnhandledRequest: 'error' });

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    msw: { handlers },
  },
  decorators: [
    (Story) => {
      resetMockDb();  // Reset before each story
      return Story();
    },
  ],
};

export default preview;
```

Now every story automatically has MSW + deterministic mock state. Individual stories can override handlers via `parameters.msw.handlers` for edge cases.

### Vite: Recommended for Dev Tooling, Not an Architectural Dependency

Use Vite for fast dev experience (Storybook builder, TanStack Start, component playgrounds). Don't architect as if Vite is always present -your code should work with any bundler.

---

## Accessibility Requirements

- Keyboard navigation for interactive controls
- Proper focus management (dialogs/menus)
- Semantic HTML first
- ARIA only when needed (and correct)
- Accessible loading + errors (don't trap users)

### Example: Accessible Dialog

```tsx
// components/Dialog.tsx
import { useEffect, useRef } from 'react';

type DialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      // Store current focus to restore later
      previousFocusRef.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else {
      dialog.close();
      // Restore focus when closing
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Note: No manual Escape handler needed -<dialog> handles it natively
  // and fires onClose when user presses Escape

  return (
    <dialog
      ref={dialogRef}
      className="rounded-lg p-0 backdrop:bg-black/50"
      aria-labelledby="dialog-title"
      onClose={onClose}
    >
      <div className="p-6">
        <h2 id="dialog-title" className="text-xl font-bold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
```

### Example: Accessible Loading State

```tsx
// Don't trap users in loading states
function DataTable({ isLoading, data }: DataTableProps) {
  return (
    <div>
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading data"
          className="p-4"
        >
          <Spinner />
          <span className="sr-only">Loading table data...</span>
        </div>
      )}

      <table aria-busy={isLoading}>
        {/* Table content remains interactive even while refreshing */}
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>{/* ... */}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## Performance Guidelines

- Measure before adding widespread memoization.
- Prefer:
  - stable data shapes
  - avoiding unnecessary re-renders through good boundaries
- Use virtualization for large lists (when needed).
- Images:
  - use framework image optimization when available
  - lazy load below the fold
- Track key metrics:
  - TTFB, LCP, CLS, INP (plus app-specific timings)

### Example: Virtualized List

```tsx
// For lists with 100+ items
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualProductList({ products }: { products: Product[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,  // Estimated row height
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const product = products[virtualRow.index];
          return (
            <div
              key={product.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ProductRow product={product} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Security Basics

- Avoid rendering unsanitized user content as HTML.
- Handle authz at boundary + enforce server-side.
- CSRF protections for cookie-based auth where applicable.
- Never leak secrets to client bundles.

### Safe Content Rendering

When you need to render user-provided content:

1. **Prefer plain text** -render as text nodes, not HTML
2. **Use markdown libraries** -they handle escaping
3. **Sanitize if HTML is required** -use DOMPurify with strict allowlists

```tsx
// ✅ SAFE: Render as text (default React behavior)
function Comment({ text }: { text: string }) {
  return <p>{text}</p>;  // React escapes automatically
}

// ✅ SAFE: Use a markdown library with sanitization
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function MarkdownContent({ markdown }: { markdown: string }) {
  // Parse markdown, then sanitize the output
  const rawHtml = marked.parse(markdown);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'code', 'pre'],
    ALLOWED_ATTR: ['href'],
  });

  return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
}
```

> **SSR note:** `DOMPurify` requires a DOM. For server-side rendering, use `isomorphic-dompurify` or sanitize on the server with a Node-compatible library like `sanitize-html`.

### Environment Variable Safety

```ts
// ❌ BAD: Secret in client bundle
const apiKey = process.env.API_SECRET_KEY;  // Bundled into client JS!

// ✅ GOOD: Only public vars in client code
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;  // Explicitly public

// ✅ GOOD: Secrets stay server-side
// In API route or server component only:
const secretKey = process.env.API_SECRET_KEY;  // Never sent to client
```

---

## Folder & File Conventions

> **Stance:** Avoid mandatory layered-architecture folders (`/domain`, `/ui`, `/app`, `/infrastructure`). Use explicit, responsibility-based folders instead. Start flat; introduce `features/` only when a feature grows large enough to need its own module (co-located components, hooks, queries).

### Recommended structure (start here)

```text
src/
├── app/                  # Framework boundary (Next.js, Remix, etc.)
│   ├── users/
│   │   ├── [id]/
│   │   │   └── page.tsx  # Container: reads params, fetches, wires handlers
│   │   └── page.tsx
│   └── layout.tsx
├── components/           # Presentational + composable UI (NO framework imports)
│   ├── Button.tsx
│   ├── Button.stories.tsx
│   ├── UserProfileView.tsx
│   └── ...
├── hooks/                # Reusable hooks (NO framework imports)
│   ├── useDebounce.ts
│   └── useLocalStorage.ts
├── providers/            # Context providers
│   ├── QueryProvider.tsx
│   ├── ThemeProvider.tsx
│   └── AuthProvider.tsx
├── queries/              # React Query hooks and keys
│   ├── userKeys.ts
│   ├── useUserQuery.ts
│   └── useUpdateUserMutation.ts
├── lib/                  # Pure utilities, types, schemas
│   ├── utils.ts
│   ├── url-state.ts
│   ├── api-error.ts
│   └── fetch-json.ts
├── features/             # Feature modules (when code grows)
│   ├── users/
│   │   ├── components/   # Feature-specific views
│   │   ├── hooks/
│   │   ├── queries/
│   │   └── index.ts
│   └── products/
│       └── ...
└── mocks/                # MSW handlers
    ├── handlers.ts
    ├── browser.ts
    └── server.ts
```

> **Where do containers go?** Containers (components that read routes, fetch data, wire handlers) live in the framework boundary folder (`app/`, `pages/`, `routes/`). This keeps `src/components/` free of framework imports and makes ESLint boundary rules enforceable.

### Naming conventions

| Pattern | Example |
| ------- | ------- |
| Container/View split | `UserProfileContainer.tsx`, `UserProfileView.tsx` |
| Client islands | `ChatClient.tsx`, `PresenceClient.tsx` |
| Providers | `AuthProvider.tsx`, `ThemeProvider.tsx` |
| Query hooks | `useUserQuery.ts`, `useProductsQuery.ts` |
| Mutation hooks | `useUpdateUserMutation.ts`, `useDeletePostMutation.ts` |
| Query keys | `userKeys.ts`, `productKeys.ts` |
| Stories | `Button.stories.tsx` (co-located) |

### Co-location

- Co-locate `*.stories.tsx` and tests near the component when practical.
- Prefer explicit over generic buckets like `misc` or `utils2`.

### Golden Feature Folder Example

Teams adopt faster with a concrete layout. Here's a complete feature module:

```text
src/
├── features/users/
│   ├── components/
│   │   ├── UserCard.tsx
│   │   ├── UserCard.stories.tsx
│   │   ├── UserCard.test.tsx
│   │   ├── UserProfileView.tsx
│   │   ├── UserProfileView.stories.tsx
│   │   └── UserListView.tsx
│   ├── queries/
│   │   ├── userKeys.ts
│   │   ├── useUserQuery.ts
│   │   ├── useUsersQuery.ts
│   │   └── useUpdateUserMutation.ts
│   ├── lib/
│   │   └── user-mappers.ts        # Pure transforms, no side effects
│   └── index.ts                   # Re-exports public API (use named exports, not `export *`. See [Monorepo Patterns](./monorepos#granular-exports-no-barrel-file-hell))
├── app/users/
│   ├── page.tsx                   # Container: UserListContainer
│   └── [id]/
│       └── page.tsx               # Container: UserProfileContainer
└── ...
```

**The one-line policy:** Only `app/` (or `routes/`, `pages/`) can import framework APIs. Everything in `features/`, `components/`, `hooks/`, `lib/`, `queries/` must be portable.

---

## ESLint: Definitive Essential Rules

### Must-have plugins

```bash
npm install -D \
  @typescript-eslint/eslint-plugin \
  @typescript-eslint/parser \
  eslint-plugin-react \
  eslint-plugin-react-hooks \
  eslint-plugin-jsx-a11y \
  eslint-plugin-import \
  eslint-plugin-unused-imports \
  eslint-plugin-no-only-tests \
  eslint-plugin-react-refresh
```

### Example: Complete ESLint Config

```js
// eslint.config.mjs
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import noOnlyTests from 'eslint-plugin-no-only-tests';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: ['.storybook/**', 'dist/**', 'node_modules/**', '*.config.{js,mjs,ts}', 'vitest.setup.ts', 'public/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,  // Required for type-aware linting
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      import: importPlugin,
      'unused-imports': unusedImports,
      'no-only-tests': noOnlyTests,
      'react-refresh': reactRefresh,
    },
    rules: {
      // TypeScript: catch async mistakes and type safety
      '@typescript-eslint/no-explicit-any': 'error',  // 100% type safety - no any allowed
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',  // Catches UI bugs (may be too strict for some optional chaining patterns)

      // React: essential rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-key': 'error',

      // Hygiene
      'unused-imports/no-unused-imports': 'error',
      'no-only-tests/no-only-tests': 'error',
      'import/order': ['warn', { 'newlines-between': 'always' }],  // Note: May need to disable if TypeScript resolver has issues
      'import/no-duplicates': 'error',

      // Large codebase protections
      'import/no-cycle': ['warn', { maxDepth: 1 }],  // Catch circular deps early
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Accessibility baseline
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/no-autofocus': 'warn',  // Common a11y footgun
    },
  },

  // Boundary enforcement: no framework imports in reusable code
  {
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/lib/**/*.{ts,tsx}',
      'src/queries/**/*.{ts,tsx}',
      'src/providers/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'next/navigation', message: 'Reusable code must not import Next routing APIs. Use adapters/DI.' },
            { name: 'next/router', message: 'Reusable code must not import Next routing APIs. Use adapters/DI.' },
            { name: 'next/headers', message: 'Reusable code must not import server-only Next APIs.' },
            { name: 'next/server', message: 'Reusable code must not import Next server APIs.' },
          ],
          patterns: [
            { group: ['@tanstack/start/**'], message: 'Reusable code must not import TanStack Start APIs.' },
            { group: ['astro/**'], message: 'Reusable code must not import Astro APIs.' },
          ],
        },
      ],
    },
  },

  // Server/client separation -only apply to explicitly marked client files
  // Avoid **/use*.{ts,tsx} as it matches server-safe hooks too
  {
    files: ['**/*.client.{ts,tsx}', 'src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fs', 'path', 'crypto'],
              message: 'Client code cannot import Node.js modules.',
            },
            {
              group: ['next/headers'],
              message: 'Client code cannot import server-only modules.',
            },
          ],
        },
      ],
    },
  },
];
```