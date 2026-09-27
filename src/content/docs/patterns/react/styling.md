---
title: "Tailwind Styling Rules"
description: "Tailwind conventions that keep class lists readable and variants explicit."
sidebar:
  order: 8
---

*Use this page when you are styling a component with Tailwind.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

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

### Hit targets and touch

Interactive controls need a 44x44px minimum touch target (WCAG 2.5.5). The `sm` (32px) and `icon` (40px) button sizes above fall short on touch devices.

- Give touch-first controls `min-h-11 min-w-11` (44px) even when the visual is smaller. Pad the hit area, not the ink.
- Apply `touch-action: manipulation` to remove the 300ms double-tap-zoom delay on tap targets.
- Icon-only controls keep the box square and at least 44px.

```tsx
// Icon button with a real hit target and an accessible name
<button
  aria-label="Delete user"
  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md
             touch-manipulation hover:bg-gray-100
             focus-visible:outline-none focus-visible:ring-2"
>
  <TrashIcon aria-hidden="true" className="h-5 w-5" />
</button>
```

For dense desktop UIs where 44px is too large, keep the visual small but expand the pressable area with padding or a `::before` overlay rather than shrinking the target.

### Icon-only buttons need a name

An icon button with no text is unlabeled to screen readers. Every `size="icon"` button requires `aria-label`, and its icon must be `aria-hidden`.

```tsx
<Button size="icon" aria-label="Close dialog">
  <XIcon aria-hidden="true" className="h-5 w-5" />
</Button>
```

Decorative icons that sit next to a text label take `aria-hidden="true"` so they aren't announced twice.

### Handle long content

User content can be short, average, or absurdly long. Design for all three; the `LongName` story catches the long case.

- Single line: `truncate`. Multi-line: `line-clamp-2`. Free text: `break-words`.
- A flex child won't shrink to truncate unless it has `min-w-0`. This is the most common truncation bug.

```tsx
<div className="flex items-center gap-3">
  <Avatar />
  <div className="min-w-0">           {/* lets the text shrink */}
    <p className="truncate font-medium">{user.name}</p>
    <p className="truncate text-sm text-gray-600">{user.email}</p>
  </div>
</div>
```

---

## Related Pages

- [Accessibility](../accessibility) for the requirements styling must not break.
