---
title: "Accessibility Requirements"
description: "Keyboard navigation, focus management, semantic HTML first, ARIA only when needed, and accessible loading and error states."
sidebar:
  order: 11
---

*Use this page when you are building an interactive control, dialog, or loading state.*

Part of the [React Architecture](../) guide, which is framework-agnostic: Next.js, TanStack Start, Astro, Remix, Vite SPA.

---

## Accessibility Requirements

- Keyboard navigation for interactive controls
- Proper focus management (dialogs/menus)
- Semantic HTML first
- ARIA only when needed (and correct)
- Accessible loading + errors (don't trap users)

Design the accessible surface before the JSX, and let the tests use it: `getByRole('button', { name: 'Place order' })` passes only when a screen reader would announce the same thing. If a test needs `data-testid` to find a control, treat that as an accessibility finding first and a test problem second. Keep axe in the Storybook play function as well as the named-role query; axe waves through some missing labels that the query catches.

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

### Custom menus and popovers

Native `<dialog>` gives you focus trapping and Escape for free. Custom overlays (dropdowns, menus, comboboxes) get none of it. If you build one, you must handle:

- Escape closes and returns focus to the trigger.
- Arrow keys move between items; Enter and Space activate.
- Click outside closes.
- Roving `tabindex` or `aria-activedescendant`, plus roles (`role="menu"`, `role="menuitem"`).

Prefer a headless primitive (Radix, React Aria, Headless UI) over hand-rolling this. They ship the keyboard model, focus management, and ARIA correctly. Hand-roll only a trivial toggle:

```tsx
function Popover({ trigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus(); // return focus to the trigger
  };

  return (
    <div onKeyDown={(e) => e.key === 'Escape' && close()}>
      <button ref={triggerRef} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && <div role="dialog" className="absolute mt-2">{children}</div>}
    </div>
  );
}
```

### Contrast

Body text needs 4.5:1 against its background. Large text (24px or more, or 19px bold) and UI boundaries need 3:1.

- `text-gray-400` on white is about 2.8:1. Use it only for large or decorative text, never for meaningful body copy. Drop muted body text to `text-gray-600` or `text-gray-700`.
- Placeholder text is not a label. It fails contrast and disappears on input. Keep a real `<label>`.
- Hover, active, and focus states must be more prominent than the rest state.

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

## Related Pages

- [Browser Journeys](../../browser-journeys) for locating by role in tests.
- [Styling](../styling) for keeping Tailwind out of the way.
