---
title: "State: URL First, Then Units That Change Together"
description: "Use the URL as the default state store and model the rest as units of things that happen together."
sidebar:
  order: 2
---

*Use this page when you are adding state and deciding where it lives.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

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

## Related Pages

- [Data Fetching](../data) for server state, which is not component state.
- [Forms](../forms) for the state a form owns.
