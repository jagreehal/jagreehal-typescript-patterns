---
title: "React Architecture"
description: "A framework-agnostic React guide split by job, with the core principles, folder conventions, security basics, and Oxlint rules on this page and one page per concern."
sidebar:
  order: 0
  label: Overview
---

*Use this page for the principles and folder conventions; use the pages below for the concern you are working on.*

This guide is **framework-agnostic**. It applies to **Next.js**, **TanStack Start**, **Astro (SSR)**, **Remix**, **Vite SPA**, etc.

The goal is to **keep reusable React code independent of routing/rendering frameworks**, with clear responsibilities, explicit dependencies, predictable state, and great testing/Storybook ergonomics.

---

## The Guide

Each page is one job, so you can hand an agent the page it needs:

| Page | Use it when |
| --- | --- |
| [Components and Responsibilities](./components) | deciding what a component owns and how it receives handlers |
| [State](./state) | adding state and deciding where it lives |
| [Data Fetching](./data) | fetching or caching server data |
| [Error Boundaries](./errors) | handling a failure in the render tree |
| [Custom Hooks and React 19 Defaults](./hooks) | extracting logic or choosing a React 19 API over a library |
| [Forms](./forms) | building or reviewing a form |
| [React Server Components](./server-components) | deciding what runs on the server |
| [Tailwind Styling Rules](./styling) | styling a component |
| [Storybook-First Development](./storybook) | building a component before the API exists |
| [Testing and MSW](./testing) | writing a React test or setting up MSW |
| [Accessibility Requirements](./accessibility) | building an interactive control or dialog |
| [Performance](./performance) | chasing a slow load or a hot re-render |

---

## Core Principles

- **Frameworks are adapters.** Routing and rendering are boundary concerns. Your reusable UI and domain logic should not import framework APIs.
- **Parent components own integration.** Parents orchestrate state + data + effects; children render.
- **Prefer URL state.** If the state is shareable, bookmarkable, or navigation-relevant, it belongs in the query string.
- **React Query is required.** Standardize server-state caching, dedupe, retries, and mutations.
- **DI for handlers.** Pass typed handlers/deps into components so tests and stories can pass their own. **Rule:** Inject anything that causes side effects (network, navigation, analytics, toasts). Import pure utilities freely.
- **Split containers from views.** Components that read URL / fetch / subscribe are separated from presentational components. **Rule:** Reusable folders (`components/`, `hooks/`, `queries/`, `lib/`) are framework-import-forbidden. Containers live only at the framework boundary (`app/`, `pages/`, `routes/`).
- **Error boundaries + Suspense are required.**
- **Every component has a paired Storybook story.**
- **Testing is value-driven.** Write a test where it reduces real risk.
- **Tailwind default.** Favor composability and consistent UI patterns.

---

## Security Basics

- Avoid rendering unsanitized user content as HTML.
- Handle authz at boundary + enforce server-side.
- CSRF protections for cookie-based auth where applicable.
- Never leak secrets to client bundles.

### Safe Content Rendering

When you need to render user-provided content:

1. **Prefer plain text.** Render as text nodes, not HTML
2. **Use markdown libraries.** They handle escaping
3. **Sanitize if HTML is required.** Use DOMPurify with strict allowlists

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

> **Where do containers go?** Containers (components that read routes, fetch data, wire handlers) live in the framework boundary folder (`app/`, `pages/`, `routes/`). This keeps `src/components/` free of framework imports and makes the lint boundary rules enforceable.

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

A complete feature folder looks like this:

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
│   └── index.ts                   # Re-exports public API (use named exports, not `export *`. See [Monorepo Patterns](../../../monorepos#granular-exports-no-barrel-file-hell))
├── app/users/
│   ├── page.tsx                   # Container: UserListContainer
│   └── [id]/
│       └── page.tsx               # Container: UserProfileContainer
└── ...
```

**The one-line policy:** Only `app/` (or `routes/`, `pages/`) can import framework APIs. Everything in `features/`, `components/`, `hooks/`, `lib/`, `queries/` must be portable.

---

## Oxlint: Definitive Essential Rules

One install plus the type-aware runner. The TypeScript, React, `jsx-a11y`, `import` and `vitest` rule sets ship inside the binary.

```bash
pnpm add -D -E oxlint oxlint-tsgolint
```

### Example: Complete Config

```ts
// oxlint.config.ts
import { defineConfig } from 'oxlint';

export default defineConfig({
  ignorePatterns: ['.storybook/**', 'dist/**', '*.config.{js,mjs,ts}', 'vitest.setup.ts', 'public/**'],
  plugins: ['typescript', 'react', 'jsx-a11y', 'import', 'vitest'],
  options: { typeAware: true }, // runs the type-aware rules through oxlint-tsgolint
  categories: { correctness: 'error' },
  rules: {
    // TypeScript: catch async mistakes and type safety
    'typescript/no-explicit-any': 'error',  // 100% type safety - no any allowed
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/consistent-type-exports': 'error',
    'typescript/no-unnecessary-condition': 'error',  // Catches UI bugs (may be too strict for some optional chaining patterns)

    // React: essential rules
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'warn',
    'react/jsx-key': 'error',
    'react/only-export-components': ['warn', { allowConstantExport: true }],

    // Hygiene
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'vitest/no-focused-tests': 'error',
    'import/no-duplicates': 'error',

    // Large codebase protections
    'import/no-cycle': ['warn', { maxDepth: 1 }],  // Catch circular deps early

    // Accessibility baseline
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/no-autofocus': 'warn',  // Common a11y footgun
  },
  overrides: [
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
        'no-restricted-imports': ['error', {
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
        }],
      },
    },

    // Server/client separation: only apply to explicitly marked client files.
    // Avoid **/use*.{ts,tsx} as it matches server-safe hooks too.
    {
      files: ['**/*.client.{ts,tsx}', 'src/client/**/*.{ts,tsx}'],
      rules: {
        'import/no-nodejs-modules': 'error',
        'no-restricted-imports': ['error', {
          patterns: [{ group: ['next/headers'], message: 'Client code cannot import server-only modules.' }],
        }],
      },
    },
  ],
});
```
