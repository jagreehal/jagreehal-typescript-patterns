---
name: ts-react
description: "Use when building React applications with Container/View split, React Query, URL state, Zod validation, DI for handlers, Error Boundaries, Storybook-first development, and framework-agnostic patterns."
---

## Overview

Framework-agnostic React architecture. Routing and rendering are boundary concerns. Reusable UI and domain logic never import framework APIs. Works with Next.js, TanStack Start, Remix, Astro SSR, Vite SPA.

## Container / View / Client Split

- **Container** (`XContainer`): lives in `app/` (or `pages/`, `routes/`). Reads route params, fetches data (React Query), wires typed handlers. Framework imports allowed here only.
- **View** (`XView`): lives in `components/`. Pure props-in, JSX-out. No framework coupling, no side effects. Easy to test and story.
- **Client** (`XClient`): only when needed for browser APIs, subscriptions, websockets, animations.

```tsx
// Container (app/users/[id]/page.tsx) -- framework boundary
export function UserProfileContainer() {
  const { id } = useParams<{ id: string }>();
  const nav = createNavigationAdapter(useRouter());
  const { data: user, isLoading, error } = useUserQuery(id);
  const handlers = { onEdit: () => nav.push(`/users/${id}/edit`) };
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorState error={error} />;
  return <UserProfileView user={user} handlers={handlers} />;
}

// View (components/UserProfileView.tsx) -- pure, portable
export function UserProfileView({ user, handlers }: Props) {
  return <div><h1>{user.name}</h1><button onClick={handlers.onEdit}>Edit</button></div>;
}
```

## Adapter Layer for Framework Portability

Define framework-agnostic ports. Implement at the boundary. Storybook provides stubs, tests provide mocks, framework migration means swapping one adapter file.

```ts
// lib/platform/ports.ts
export type NavigationApi = { push: (href: string) => void; replace?: (href: string) => void; back?: () => void };
export type ToastService = { success: (msg: string) => void; error: (msg: string) => void };

// adapters/navigation.ts -- wrap whatever router your framework gives you
export function createNavigationAdapter(router: RouterLike): NavigationApi { ... }
```

## URL State with Zod Schemas

Use the query string for filters, sorting, pagination, tabs, search. Parse with `safeParse` (never `parse`); URL params are untrusted input. Fall back to schema defaults on invalid input.

```ts
export function parseProductFilters(searchParams: SearchParamsLike): ProductFilters {
  const result = productFiltersSchema.safeParse({ /* extract params */ });
  return result.success ? result.data : defaultProductFilters; // never crash on ?page=lol
}
```

Serialize only non-default values. Merge with existing URL params to preserve unrelated keys (feature flags, other widgets).

## Discriminated Unions for UI State

Never use scattered booleans. Model states as discriminated unions to make impossible states unrepresentable.

```ts
type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error };
```

## React Query Baseline

Required for all server state. Key patterns:

**Key factories**: composable, stable, JSON-serializable:
```ts
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: Filters) => [...userKeys.lists(), filters] as const,
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
};
```

**Policy:** `staleTime: 5 * 60 * 1000` default. Retry up to 3 for 5xx/network/408/429; no retry on other 4xx. Mutations never auto-retry.

**QueryProvider**: one file with `QueryCache`/`MutationCache` error logging (skip 4xx), retry policy, and `ReactQueryDevtools`. Wire once in root layout.

## DI: handlers vs deps

| Prop | Purpose | Examples |
|------|---------|---------|
| `handlers` | User-intent callbacks | `onDelete`, `onEdit`, `onSubmit` |
| `deps` | Capabilities/services | `nav`, `toast`, `track`, `clipboard` |

Inject anything that causes side effects. Import pure utilities freely.

## Error Boundaries + Suspense

Both are mandatory. Use `QueryErrorResetBoundary` + `ErrorBoundary` + `Suspense` together. Isolate Suspense boundaries so one slow component does not block siblings. Layers: route-level, feature-level, query/mutation-level.

## Storybook-First Development with MSW

Build stories with MSW before wiring to real backends. Every component has a paired story covering: default, loading, empty, error, edge cases. Use `fn()` for handlers. Use `msw-storybook-addon` with `resetMockDb()` in decorators. Feature flow storyboards use play functions for multi-step demos.

## React Hook Form + Zod

Forms use `react-hook-form` + `@hookform/resolvers` + Zod. Schema is single source of truth. Prefer `register` (uncontrolled); use `Controller` only for components that require controlled props. Map server errors with `setError`.

## Folder Conventions

```
app/         -- containers (framework boundary, framework imports OK)
components/  -- views (NO framework imports)
hooks/       -- reusable hooks (NO framework imports)
queries/     -- React Query hooks + key factories
lib/         -- pure utilities, schemas, types
providers/   -- context providers
features/    -- feature modules when code grows (co-located components/hooks/queries)
mocks/       -- MSW handlers
```

## ESLint Boundary Enforcement

Use `no-restricted-imports` to ban `next/navigation`, `next/router`, `next/headers`, `@tanstack/start/**`, `astro/**` from `src/components/`, `src/hooks/`, `src/lib/`, `src/queries/`, `src/providers/`. Only `app/` can import framework APIs.
