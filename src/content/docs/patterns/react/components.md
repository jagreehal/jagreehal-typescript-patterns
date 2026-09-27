---
title: "Components and Responsibilities"
description: "Parents own integration, children render; inject handlers and deps into components; use context for real shared state instead of prop drilling."
sidebar:
  order: 1
---

*Use this page when you are deciding what a component should own, how it receives handlers, or whether to reach for context.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

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

Teams still couple to `useRouter`, `navigate`, `notFound`, etc. because there's no explicit adapter surface. Define framework-agnostic interfaces and implement them at the boundary:

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

Now containers depend on `NavigationApi` instead of framework-specific hooks. Storybook provides a stub, tests provide a mock, and migrating frameworks means swapping a single adapter file.

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

## Dependency Injection for Components (Handlers / Deps)

Components should accept typed "capabilities" via props instead of importing concrete side-effectful functions.

### The Distinction: handlers vs deps

Without a hard rule, teams mix these. Split them like this:

| Prop      | Purpose                                    | Examples                                    |
|-----------|--------------------------------------------|---------------------------------------------|
| `handlers` | User-intent callbacks (UI events)          | `onDelete`, `onEdit`, `onSubmit`, `onSelect` |
| `deps`     | Capabilities/services (platform features)   | `nav`, `toast`, `track`, `clipboard`, `time` |

Storybook provides dumb stubs for `deps`, while tests assert `handlers` calls. The split shows which props are "what happens" (handlers) vs "what tools exist" (deps).

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

- Use Context to **group cohesive feature subtrees**. Don't turn it into a global dumping ground.
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

## Related Pages

- [Custom Hooks](../hooks) for logic that outgrows a component.
- [Storybook](../storybook) is where the injected handlers pay off.
- [Functions Over Classes](../../functions) is the same `fn(args, deps)` idea outside React.
