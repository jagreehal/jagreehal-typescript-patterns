---
title: "Performance: Bundle Size and Re-renders"
description: "Avoid barrel imports, code-split heavy code, and fix re-renders by measuring first."
sidebar:
  order: 12
---

*Use this page when you are chasing a slow load or a hot re-render.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Bundle Size

### Avoid barrel imports

Barrel files (an `index.ts` doing `export *`) pull thousands of unused modules into your graph. Icon and component libraries ship up to 10,000 re-exports. Importing them costs 200ms to 800ms on every cold start and slows HMR.

```tsx
// ❌ BAD: loads the whole library
import { Check, X, Menu } from 'lucide-react';
import { Button, TextField } from '@mui/material';

// ✅ GOOD: import directly from source paths
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
```

Commonly affected: `lucide-react`, `@mui/material`, `@mui/icons-material`, `react-icons`, `@radix-ui/react-*`, `lodash`, `date-fns`, `rxjs`.

**Framework shortcut (Next.js 13.5+):** `experimental.optimizePackageImports` rewrites barrel imports to direct ones at build time while keeping types and autocomplete. Confirm a library ships types for its deep paths before importing them directly, since some (like `lucide-react`) don't.

### Code-split heavy and non-critical code

Lazy-load anything not needed for the first paint: editors, charts, maps, modals. Use `React.lazy` + `Suspense` (portable) or your framework's dynamic loader.

```tsx
// ❌ BAD: Monaco (~300KB) ships in the main chunk
import { MonacoEditor } from './MonacoEditor';

// ✅ GOOD: loads on demand
import { lazy, Suspense } from 'react';
const MonacoEditor = lazy(() => import('./MonacoEditor').then((m) => ({ default: m.MonacoEditor })));

function CodePanel({ code }: { code: string }) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <MonacoEditor value={code} />
    </Suspense>
  );
}
```

Preload on intent (hover or focus) so the chunk is warm before the click. Guard with `typeof window` so the import never enters the server bundle.

```tsx
function EditorButton({ onClick }: { onClick: () => void }) {
  const preload = () => { if (typeof window !== 'undefined') void import('./MonacoEditor'); };
  return <button onMouseEnter={preload} onFocus={preload} onClick={onClick}>Open editor</button>;
}
```

Defer non-critical third-party code (analytics, logging, error tracking) until after hydration. It never blocks interaction, so it shouldn't sit in the initial bundle.

> **Framework note:** Next.js `next/dynamic` with `{ ssr: false }` covers both the split and the hydration-defer in one call.

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

## Re-render Optimization

Measure before memoizing. Some patterns cause re-renders (or full remounts) unconditionally, though, and you should fix those on sight.

### Don't define components inside components

A component defined in another component is a new type on every render. React remounts it, destroying its state, focus, and DOM.

```tsx
// ❌ BAD: Avatar is a new type each render; the input loses focus and effects re-run
function UserProfile({ user, theme }: Props) {
  const Avatar = () => <img src={user.avatarUrl} className={theme} />;
  return <div><Avatar /></div>;
}

// ✅ GOOD: hoist it, pass props
function Avatar({ src, theme }: { src: string; theme: string }) {
  return <img src={src} className={theme} />;
}
function UserProfile({ user, theme }: Props) {
  return <div><Avatar src={user.avatarUrl} theme={theme} /></div>;
}
```

Symptoms: inputs losing focus per keystroke, animations restarting, `useEffect` re-running on every parent render.

### Derive state during render, not in effects

When a value comes from current props or state, compute it inline. Storing it in state and syncing via `useEffect` adds a redundant render and invites drift.

```tsx
// ❌ BAD: extra state, extra render
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ GOOD: derive it
const fullName = `${first} ${last}`;
```

### Use functional setState

When new state depends on old state, use the updater form. The callback needs no state dependency, stays stable, and can't go stale.

```tsx
// ❌ BAD: recreated on every items change; the second is a stale-closure bug
const addItems = useCallback((next: Item[]) => setItems([...items, ...next]), [items]);
const removeItem = useCallback((id: string) => setItems(items.filter((i) => i.id !== id)), []);

// ✅ GOOD: stable, always the latest state
const addItems = useCallback((next: Item[]) => setItems((curr) => [...curr, ...next]), []);
const removeItem = useCallback((id: string) => setItems((curr) => curr.filter((i) => i.id !== id)), []);
```

### Lazy-init expensive state

`useState(expensive())` runs `expensive()` on every render. Pass a function so it runs once. The chapter already does this for `QueryClient`.

```tsx
// ❌ BAD: buildIndex runs every render
const [index] = useState(buildIndex(items));

// ✅ GOOD: runs once
const [index] = useState(() => buildIndex(items));
```

Use it for `localStorage` reads, index and map construction, and DOM reads. Skip it for primitives and cheap literals (`useState(0)`, `useState({})`).

### Memo the component, not the trivial expression

Extract expensive work into a `memo`'d component so early returns skip it. Don't wrap cheap primitive expressions in `useMemo`, since the dependency comparison costs more than the work.

```tsx
// ❌ BAD: computes avatar even while loading
const avatar = useMemo(() => <Avatar id={computeId(user)} />, [user]);
if (loading) return <Skeleton />;

// ✅ GOOD: extract, return early, compute only when rendered
const UserAvatar = memo(({ user }: { user: User }) => <Avatar id={computeId(user)} />);
if (loading) return <Skeleton />;
return <UserAvatar user={user} />;

// ❌ BAD: pointless memo around a boolean
const isLoading = useMemo(() => a.isLoading || b.isLoading, [a.isLoading, b.isLoading]);
// ✅ GOOD
const isLoading = a.isLoading || b.isLoading;
```

If you run React Compiler, drop all manual `memo` and `useMemo`; the compiler handles memoization.

### useRef for transient values

Values that change many times a second (mouse position, scroll offset, timers) don't belong in state. `useState` re-renders on every update; a ref doesn't.

```tsx
// ✅ track without re-rendering; write straight to the DOM node
const lastXRef = useRef(0);
const dotRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const onMove = (e: MouseEvent) => {
    lastXRef.current = e.clientX;
    if (dotRef.current) dotRef.current.style.transform = `translateX(${e.clientX}px)`;
  };
  window.addEventListener('mousemove', onMove);
  return () => window.removeEventListener('mousemove', onMove);
}, []);
```

### useDeferredValue for heavy filtering

When typing drives an expensive render (filtering a large list, redrawing a chart), defer the derived value so input stays responsive. This complements the `useTransition` example above.

```tsx
function Search({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const filtered = useMemo(() => items.filter((i) => fuzzyMatch(i, deferred)), [items, deferred]);
  const isStale = query !== deferred;

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.7 : 1 }}>
        <ResultsList results={filtered} />
      </div>
    </>
  );
}
```

Keep the computation in `useMemo` keyed on the deferred value, or it re-runs every render anyway.

---

## Related Pages

- [Monorepo Patterns](../../monorepos#granular-exports-no-barrel-file-hell) for the barrel-file problem at package level.
- [Performance Testing](../../performance) for measuring under load.
