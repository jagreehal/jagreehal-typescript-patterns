---
title: "Custom Hooks and React 19 Defaults"
description: "When a custom hook earns its place, how to shape it, and which React 19 built-ins to use before adding a library."
sidebar:
  order: 5
---

*Use this page when you are extracting logic into a hook or choosing between a React 19 API and a library.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Custom Hooks Patterns

### When to Extract a Hook

Extract a hook when:

1. **Reuse.** The same stateful logic appears in multiple components
2. **Complexity.** A component's logic is hard to follow
3. **Testing.** You want to test the logic separately from the UI

Don't extract a hook to "organize code." If it's only used once and the component is readable, leave it inline.

### Naming Conventions

| Pattern | Example | Use for |
| ------- | ------- | ------- |
| `use{Thing}` | `useDebounce`, `useLocalStorage` | Primitive utilities |
| `use{Thing}Query` | `useUserQuery`, `useProductsQuery` | React Query wrappers |
| `use{Thing}Mutation` | `useUpdateUserMutation` | React Query mutations |
| `use{Thing}State` | `useFormState`, `useDialogState` | Local state management |
| `use{Feature}` | `useCheckout`, `useAuth` | Feature-specific composition |

### Primitive Hooks (Reusable Utilities)

These are small, focused, and reusable:

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

Compose primitive hooks into feature-specific hooks. Inject framework-aware logic (like reading URL params) as deps instead of importing it, so hooks stay portable and testable:

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
- you have measured a real performance issue

---

## Related Pages

- [Components and Responsibilities](../components) for what stays in the component.
- [Forms](../forms) for the form-specific React 19 APIs.
