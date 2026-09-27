---
title: "React Server Components"
description: "Where RSC fits, what stays on the server, and how the server/client boundary is kept lint-enforceable."
sidebar:
  order: 7
---

*Use this page when you are working in a framework with server components and deciding what runs where.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## React Server Components (RSC)

> **Note:** This section applies to frameworks that support RSC (Next.js App Router, etc.). **If your framework doesn't support RSC (Vite SPA, CRA, older Next.js), skip this section.** The Container/View pattern from earlier sections is your model. RSC moves the Container to the server.

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
      {/* Static content: no client JS needed */}
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
      {/* Server Component: rendered on server, no client JS */}
      <DashboardStats stats={stats} />

      {/* Client Component: hydrated on client for interactivity */}
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

### Parallel Fetching in Server Components

Server Components render depth-first, so a parent's `await` blocks its siblings. Push each fetch into the component that needs it so they run at once.

```tsx
// ❌ BAD: Sidebar can't start until Page's fetch resolves
export default async function Page() {
  const header = await fetchHeader();
  return <div><Header data={header} /><Sidebar /></div>;
}

// ✅ GOOD: siblings fetch in parallel
async function Header() { return <div>{await fetchHeader()}</div>; }
async function Sidebar() { return <nav>{(await fetchSidebarItems()).map(renderItem)}</nav>; }
export default function Page() {
  return <div><Header /><Sidebar /></div>;
}
```

For nested fetches, chain inside each item's promise so one slow item doesn't stall the rest.

```ts
// ❌ BAD: all authors wait for the slowest chat
const chats = await Promise.all(ids.map(getChat));
const authors = await Promise.all(chats.map((c) => getUser(c.author)));

// ✅ GOOD: each item chains independently
const authors = await Promise.all(ids.map((id) => getChat(id).then((c) => getUser(c.author))));
```

To show the shell before data lands, wrap the async child in `Suspense` instead of awaiting in the parent.

```tsx
export default function Page() {
  return (
    <div>
      <Header />
      <Suspense fallback={<Skeleton />}><DataDisplay /></Suspense>
      <Footer />
    </div>
  );
}
```

Deduplicate per request with `React.cache()`. Auth checks and DB queries called from multiple components then run once per request.

```ts
import { cache } from 'react';

export const getCurrentUser = cache(async () => {
  const session = await auth();
  return session ? db.user.findUnique({ where: { id: session.userId } }) : null;
});
```

Pass primitive args, not inline objects. `cache` compares with `Object.is`, so `getUser({ id: 1 })` misses every time. Use `getUser(1)`. Pass the minimum data across a `'use client'` boundary too, since large payloads inflate the serialized stream.

> **Framework note:** Next.js already memoizes `fetch` per request. `React.cache()` covers the non-fetch work: DB queries, auth, file reads.

### RSC + React Query

> **When to use each:** Server Components fetch directly (no React Query needed). React Query is for client-side cache, mutations, and real-time updates.

RSC apps still use React Query for:

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

## Related Pages

- [Enforcing Patterns with Oxlint](../../lint#enforcing-server-only-boundaries) for the lint rules that keep server code out of the client.
- [Data Fetching](../data) for the client-side half.
